import { ObjectId } from "mongodb";
import { io } from "../socket/socket.js";
import client from "../config/db.js";

const userCollection = client.db("nexoro").collection("Users");
const clientCollection = client.db("nexoro").collection("Clients");
const orderCollection = client.db("nexoro").collection("Orders");
const expenseCollection = client.db("nexoro").collection("expenses");

const ADMIN_ROOM = "admin_global_room";

/**
 * Helper to calculate percentage increase or decrease compared to previous period.
 * - Returns percentage capped at 100%
 * - Positive or zero indicates increase, negative indicates decrease.
 * - Formatted with sign, numeric percentage, and direction flags.
 */
const calculateMetricStats = (currentVal, prevVal) => {
  let percentage = 0;
  let isIncrease = true;

  if (prevVal === 0) {
    percentage = currentVal > 0 ? 100 : 0;
    isIncrease = currentVal >= 0;
  } else {
    const rawDiff = ((currentVal - prevVal) / Math.abs(prevVal)) * 100;
    isIncrease = rawDiff >= 0;

    const absDiff = Math.abs(rawDiff);
    const capped = Math.min(absDiff, 100);
    percentage = Number(capped.toFixed(1));
  }

  return {
    total: Math.round(currentVal),
    previousMonth: Math.round(prevVal),
    percentage,
    isIncrease,
    trend: isIncrease ? "up" : "down",
    text: `${percentage}%`,
  };
};

/**
 * Aggregate standalone expenses from expenses collection.
 */
const getStandaloneExpenses = async (startDate, endDate) => {
  const pipeline = [
    {
      $project: {
        amount: 1,
        effectiveDate: {
          $convert: {
            input: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$invoiceDate", null] },
                    { $ne: ["$invoiceDate", ""] },
                  ],
                },
                "$invoiceDate",
                "$createdAt",
              ],
            },
            to: "date",
            onError: "$createdAt",
            onNull: "$createdAt",
          },
        },
      },
    },
  ];

  if (startDate && endDate) {
    pipeline.push({
      $match: {
        effectiveDate: { $gte: startDate, $lte: endDate },
      },
    });
  } else if (endDate) {
    pipeline.push({
      $match: {
        effectiveDate: { $lt: endDate },
      },
    });
  }

  pipeline.push({
    $group: {
      _id: null,
      total: {
        $sum: {
          $convert: {
            input: "$amount",
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
      },
      count: { $sum: 1 },
    },
  });

  const result = await expenseCollection.aggregate(pipeline).toArray();

  return {
    total: result[0]?.total || 0,
    count: result[0]?.count || 0,
  };
};

/**
 * Aggregate project costs / expenses recorded within Orders.
 * Supports both individual items in `costs` array and fallback `totalCost`.
 * Prevents double-counting.
 */
const getOrderCosts = async (startDate, endDate) => {
  const matchStage = {
    status: { $ne: "Cancelled" },
  };

  const facetPipeline = [
    { $match: matchStage },
    {
      $project: {
        createdAt: 1,
        costs: { $ifNull: ["$costs", []] },
        totalCost: {
          $convert: {
            input: "$totalCost",
            to: "double",
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    {
      $facet: {
        // Unwind costs array
        fromCostsArray: [
          { $unwind: "$costs" },
          {
            $project: {
              amount: {
                $convert: {
                  input: "$costs.amount",
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
              date: {
                $convert: {
                  input: { $ifNull: ["$costs.date", "$createdAt"] },
                  to: "date",
                  onError: "$createdAt",
                  onNull: "$createdAt",
                },
              },
            },
          },
          ...(startDate && endDate
            ? [{ $match: { date: { $gte: startDate, $lte: endDate } } }]
            : endDate
            ? [{ $match: { date: { $lt: endDate } } }]
            : []),
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ],
        // Orders with totalCost > 0 but empty or missing costs array
        fromTotalCostOnly: [
          {
            $match: {
              $and: [
                { totalCost: { $gt: 0 } },
                {
                  $or: [
                    { costs: { $size: 0 } },
                    { costs: { $exists: false } },
                  ],
                },
              ],
            },
          },
          ...(startDate && endDate
            ? [{ $match: { createdAt: { $gte: startDate, $lte: endDate } } }]
            : endDate
            ? [{ $match: { createdAt: { $lt: endDate } } }]
            : []),
          {
            $group: {
              _id: null,
              total: { $sum: "$totalCost" },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ];

  const result = await orderCollection.aggregate(facetPipeline).toArray();
  const facet = result[0] || {};
  const fromArray = facet.fromCostsArray?.[0]?.total || 0;
  const fromTotalCost = facet.fromTotalCostOnly?.[0]?.total || 0;
  const count =
    (facet.fromCostsArray?.[0]?.count || 0) +
    (facet.fromTotalCostOnly?.[0]?.count || 0);

  return {
    total: fromArray + fromTotalCost,
    count,
  };
};

/**
 * Aggregate received income / revenue from non-cancelled orders.
 */
const getIncome = async (startDate, endDate) => {
  const match = {
    status: { $ne: "Cancelled" },
    payment: { $in: ["Success", "Partial"] },
  };

  if (startDate && endDate) {
    match.createdAt = { $gte: startDate, $lte: endDate };
  } else if (endDate) {
    match.createdAt = { $lt: endDate };
  }

  const result = await orderCollection
    .aggregate([
      { $match: match },
      {
        $project: {
          amount: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          price: {
            $convert: {
              input: { $ifNull: ["$servicePrice", "$price"] },
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          payment: 1,
        },
      },
      {
        $project: {
          effectiveIncome: {
            $cond: [
              {
                $and: [
                  { $eq: ["$payment", "Success"] },
                  { $eq: ["$amount", 0] },
                  { $gt: ["$price", 0] },
                ],
              },
              "$price",
              "$amount",
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$effectiveIncome" },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();

  return result[0]?.total || 0;
};

/**
 * Fetch detailed itemized breakdown of orders and expenses in the specified date range.
 */
const getPeriodBreakdown = async (startDate, endDate) => {
  if (!startDate || !endDate) return { orders: [], expenses: [], orderCosts: [] };

  const [orders, expenses, ordersWithCosts] = await Promise.all([
    // 1. Non-cancelled orders placed in this period
    orderCollection
      .find({
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $ne: "Cancelled" },
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),

    // 2. Standalone expenses in this period
    expenseCollection
      .aggregate([
        {
          $project: {
            title: 1,
            invoice: 1,
            invoiceDate: 1,
            amount: {
              $convert: {
                input: "$amount",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
            paymentStatus: 1,
            paymentMethod: 1,
            paidTo: 1,
            frequency: 1,
            createdAt: 1,
            effectiveDate: {
              $convert: {
                input: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$invoiceDate", null] },
                        { $ne: ["$invoiceDate", ""] },
                      ],
                    },
                    "$invoiceDate",
                    "$createdAt",
                  ],
                },
                to: "date",
                onError: "$createdAt",
                onNull: "$createdAt",
              },
            },
          },
        },
        {
          $match: {
            effectiveDate: { $gte: startDate, $lte: endDate },
          },
        },
        { $sort: { effectiveDate: -1 } },
        { $limit: 100 },
      ])
      .toArray(),

    // 3. Orders with project costs in this period
    orderCollection
      .find({
        status: { $ne: "Cancelled" },
        $or: [
          { "costs.0": { $exists: true } },
          { totalCost: { $gt: 0 } },
        ],
      })
      .limit(100)
      .toArray(),
  ]);

  // Enrich orders with client name/email
  const enrichedOrders = await Promise.all(
    orders.map(async (order) => {
      let clientName = order.createdBy || "Customer";
      let clientEmail = order.createdById || "";
      if (order.clientId) {
        try {
          const clientDoc = await clientCollection.findOne({
            _id: new ObjectId(order.clientId),
          });
          if (clientDoc) {
            clientName = clientDoc.name || clientName;
            clientEmail = clientDoc.email || clientEmail;
          }
        } catch {}
      }
      return {
        _id: order._id,
        orderId: order.orderId,
        service: order.service,
        serviceName: order.serviceName || order.service,
        price: Number(order.price) || 0,
        amount: Number(order.amount) || 0,
        discount: Number(order.discount) || 0,
        payment: order.payment || "Pending",
        status: order.status || "Pending",
        clientName,
        clientEmail,
        createdAt: order.createdAt,
      };
    })
  );

  // Extract order project costs that fall in the date range
  const matchedOrderCosts = [];
  ordersWithCosts.forEach((order) => {
    if (Array.isArray(order.costs) && order.costs.length > 0) {
      order.costs.forEach((cost) => {
        const costDate = cost.date ? new Date(cost.date) : order.createdAt;
        if (costDate >= startDate && costDate <= endDate) {
          matchedOrderCosts.push({
            orderId: order.orderId,
            serviceName: order.serviceName || order.service,
            title: cost.name || cost.title || "Project Cost",
            amount: Number(cost.amount) || 0,
            date: costDate,
          });
        }
      });
    } else if (order.totalCost > 0 && order.createdAt >= startDate && order.createdAt <= endDate) {
      matchedOrderCosts.push({
        orderId: order.orderId,
        serviceName: order.serviceName || order.service,
        title: "Order Cost",
        amount: Number(order.totalCost) || 0,
        date: order.createdAt,
      });
    }
  });

  return {
    orders: enrichedOrders,
    expenses: expenses.map((e) => ({
      _id: e._id,
      title: e.title,
      invoice: e.invoice || "",
      invoiceDate: e.invoiceDate || "",
      amount: e.amount || 0,
      paymentStatus: e.paymentStatus || "paid",
      paymentMethod: e.paymentMethod || "cash",
      paidTo: e.paidTo || "",
      frequency: e.frequency || "single",
      date: e.effectiveDate || e.createdAt,
    })),
    orderCosts: matchedOrderCosts,
  };
};

/**
 * Fetch counts and financial metrics in parallel across collections with previous period comparison.
 * Supports optional custom startDate and endDate strings (e.g. "2026-10-02" or ISO format).
 */
/**
 * Helper to compute period date boundaries and labels consistently
 */
export const parsePeriodDates = (customStart, customEnd) => {
  const now = new Date();
  let currentStart, currentEnd;
  let prevStart, prevEnd;
  let isCustom = false;
  let periodLabel = "Current Month";

  if (customStart) {
    isCustom = true;
    const startStr = String(customStart).includes("T")
      ? customStart
      : `${customStart}T00:00:00.000+06:00`;
    const endTarget = customEnd || customStart;
    const endStr = String(endTarget).includes("T")
      ? endTarget
      : `${endTarget}T23:59:59.999+06:00`;

    currentStart = new Date(startStr);
    currentEnd = new Date(endStr);

    if (isNaN(currentStart.getTime())) currentStart = new Date(customStart);
    if (isNaN(currentEnd.getTime())) currentEnd = new Date(endTarget);

    const durationMs = Math.max(1000, currentEnd.getTime() - currentStart.getTime());
    prevEnd = new Date(currentStart.getTime() - 1);
    prevStart = new Date(currentStart.getTime() - durationMs);

    const isSingleDay =
      currentStart.getFullYear() === currentEnd.getFullYear() &&
      currentStart.getMonth() === currentEnd.getMonth() &&
      currentStart.getDate() === currentEnd.getDate();

    if (isSingleDay) {
      periodLabel = currentStart.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Dhaka",
      });
    } else {
      periodLabel = `${currentStart.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "Asia/Dhaka",
      })} - ${currentEnd.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Dhaka",
      })}`;
    }
  } else {
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    // Current month date boundaries
    currentStart = new Date(year, month, 1, 0, 0, 0, 0);
    currentEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // Previous month date boundaries
    prevStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    prevEnd = new Date(year, month, 0, 23, 59, 59, 999);
    periodLabel = "Current Month";
  }

  return { currentStart, currentEnd, prevStart, prevEnd, periodLabel, isCustom };
};

/**
 * Fetch backend-paginated itemized breakdown (Orders or Expenses) for the period.
 */
export const getPaginatedPeriodBreakdown = async ({
  startDate,
  endDate,
  tab = "orders",
  page = 1,
  limit = 10,
  search = "",
}) => {
  const { currentStart, currentEnd, periodLabel } = parsePeriodDates(startDate, endDate);
  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.max(1, parseInt(limit) || 10);
  const skip = (parsedPage - 1) * parsedLimit;

  // Compute period totals & KPI summary in parallel
  const [totalOrdersInPeriod, standaloneExpensesResult, orderCostsResult, incomeTotal] =
    await Promise.all([
      orderCollection.countDocuments({
        createdAt: { $gte: currentStart, $lte: currentEnd },
        status: { $ne: "Cancelled" },
      }),
      getStandaloneExpenses(currentStart, currentEnd),
      getOrderCosts(currentStart, currentEnd),
      getIncome(currentStart, currentEnd),
    ]);

  const totalPeriodExpenses = standaloneExpensesResult.count + orderCostsResult.count;
  const totalPeriodExpenseAmount = standaloneExpensesResult.total + orderCostsResult.total;
  const netDifference = incomeTotal - totalPeriodExpenseAmount;

  const summary = {
    totalOrders: totalOrdersInPeriod,
    totalExpenses: totalPeriodExpenses,
    totalIncome: Math.round(incomeTotal),
    totalExpenseAmount: Math.round(totalPeriodExpenseAmount),
    netDifference: Math.round(netDifference),
    periodLabel,
  };

  // 1. Tab: EXPENSES & COSTS
  if (tab === "expenses") {
    const pipeline = [
      {
        $project: {
          _id: { $toString: "$_id" },
          title: "$title",
          ref: { $ifNull: ["$invoice", "-"] },
          paidTo: { $ifNull: ["$paidTo", "-"] },
          amount: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          paymentStatus: { $ifNull: ["$paymentStatus", "paid"] },
          paymentMethod: { $ifNull: ["$paymentMethod", "N/A"] },
          date: {
            $convert: {
              input: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$invoiceDate", null] },
                      { $ne: ["$invoiceDate", ""] },
                    ],
                  },
                  "$invoiceDate",
                  "$createdAt",
                ],
              },
              to: "date",
              onError: "$createdAt",
              onNull: "$createdAt",
            },
          },
          type: { $literal: "General Expense" },
        },
      },
      {
        $match: {
          date: { $gte: currentStart, $lte: currentEnd },
        },
      },
      {
        $unionWith: {
          coll: "Orders",
          pipeline: [
            {
              $match: {
                status: { $ne: "Cancelled" },
                $or: [
                  { "costs.0": { $exists: true } },
                  { totalCost: { $gt: 0 } },
                ],
              },
            },
            {
              $project: {
                orderId: 1,
                serviceName: { $ifNull: ["$serviceName", "$service"] },
                createdAt: 1,
                costs: { $ifNull: ["$costs", []] },
                totalCost: {
                  $convert: {
                    input: "$totalCost",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
            {
              $facet: {
                fromCosts: [
                  { $unwind: "$costs" },
                  {
                    $project: {
                      _id: {
                        $concat: [
                          { $ifNull: ["$orderId", ""] },
                          "-",
                          { $ifNull: ["$costs.name", { $ifNull: ["$costs.title", "cost"] }] },
                          "-",
                          {
                            $dateToString: {
                              date: {
                                $convert: {
                                  input: { $ifNull: ["$costs.date", "$createdAt"] },
                                  to: "date",
                                  onError: "$createdAt",
                                  onNull: "$createdAt",
                                },
                              },
                            },
                          },
                        ],
                      },
                      title: {
                        $concat: [
                          { $ifNull: ["$serviceName", "Service"] },
                          " - ",
                          { $ifNull: ["$costs.name", { $ifNull: ["$costs.title", "Project Cost"] }] },
                        ],
                      },
                      ref: { $ifNull: ["$orderId", "-"] },
                      paidTo: { $literal: "Project Expense" },
                      amount: {
                        $convert: {
                          input: "$costs.amount",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      paymentStatus: { $literal: "Paid" },
                      paymentMethod: { $literal: "Internal" },
                      date: {
                        $convert: {
                          input: { $ifNull: ["$costs.date", "$createdAt"] },
                          to: "date",
                          onError: "$createdAt",
                          onNull: "$createdAt",
                        },
                      },
                      type: { $literal: "Order Cost" },
                    },
                  },
                  {
                    $match: {
                      date: { $gte: currentStart, $lte: currentEnd },
                    },
                  },
                ],
                fromTotalCostOnly: [
                  {
                    $match: {
                      totalCost: { $gt: 0 },
                      costs: { $size: 0 },
                      createdAt: { $gte: currentStart, $lte: currentEnd },
                    },
                  },
                  {
                    $project: {
                      _id: { $concat: [{ $ifNull: ["$orderId", ""] }, "-Order Cost"] },
                      title: {
                        $concat: [
                          { $ifNull: ["$serviceName", "Service"] },
                          " - Order Cost",
                        ],
                      },
                      ref: { $ifNull: ["$orderId", "-"] },
                      paidTo: { $literal: "Project Expense" },
                      amount: "$totalCost",
                      paymentStatus: { $literal: "Paid" },
                      paymentMethod: { $literal: "Internal" },
                      date: "$createdAt",
                      type: { $literal: "Order Cost" },
                    },
                  },
                ],
              },
            },
            {
              $project: {
                allCosts: { $concatArrays: ["$fromCosts", "$fromTotalCostOnly"] },
              },
            },
            { $unwind: "$allCosts" },
            { $replaceRoot: { newRoot: "$allCosts" } },
          ],
        },
      },
    ];

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      pipeline.push({
        $match: {
          $or: [
            { title: { $regex: searchRegex } },
            { paidTo: { $regex: searchRegex } },
            { ref: { $regex: searchRegex } },
            { paymentMethod: { $regex: searchRegex } },
          ],
        },
      });
    }

    pipeline.push({ $sort: { date: -1 } });
    pipeline.push({
      $facet: {
        metadata: [{ $count: "total" }],
        data: [{ $skip: skip }, { $limit: parsedLimit }],
      },
    });

    const facetRes = await expenseCollection.aggregate(pipeline).toArray();
    const facetData = facetRes[0] || {};
    const totalFiltered = facetData.metadata?.[0]?.total || 0;
    const items = facetData.data || [];

    return {
      tab: "expenses",
      items,
      pagination: {
        currentPage: parsedPage,
        totalPages: Math.ceil(totalFiltered / parsedLimit) || 1,
        totalItems: totalFiltered,
        limit: parsedLimit,
        hasNext: parsedPage * parsedLimit < totalFiltered,
        hasPrev: parsedPage > 1,
        start: totalFiltered === 0 ? 0 : skip + 1,
        end: Math.min(skip + parsedLimit, totalFiltered),
      },
      summary,
    };
  }

  // 2. Tab: ORDERS & REVENUE
  const orderQuery = {
    createdAt: { $gte: currentStart, $lte: currentEnd },
    status: { $ne: "Cancelled" },
  };

  if (search && search.trim()) {
    const searchRegex = new RegExp(search.trim(), "i");
    const matchingClients = await clientCollection
      .find({
        $or: [
          { name: { $regex: searchRegex } },
          { email: { $regex: searchRegex } },
        ],
      })
      .project({ _id: 1 })
      .toArray();
    const matchingClientIds = matchingClients.map((c) => c._id.toString());

    orderQuery.$or = [
      { orderId: { $regex: searchRegex } },
      { service: { $regex: searchRegex } },
      { serviceName: { $regex: searchRegex } },
      { clientName: { $regex: searchRegex } },
      { clientEmail: { $regex: searchRegex } },
      { createdBy: { $regex: searchRegex } },
      { "epsData.CustomerName": { $regex: searchRegex } },
      { "epsData.CustomerEmail": { $regex: searchRegex } },
      ...(matchingClientIds.length > 0
        ? [{ clientId: { $in: matchingClientIds } }]
        : []),
    ];
  }

  const [totalFilteredOrders, orders] = await Promise.all([
    orderCollection.countDocuments(orderQuery),
    orderCollection
      .find(orderQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .toArray(),
  ]);

  const enrichedOrders = await Promise.all(
    orders.map(async (order) => {
      let clientName = order.createdBy || order.epsData?.CustomerName || "Customer";
      let clientEmail = order.createdById || order.epsData?.CustomerEmail || "";
      if (order.clientId) {
        try {
          const clientDoc = await clientCollection.findOne({
            _id: new ObjectId(order.clientId),
          });
          if (clientDoc) {
            clientName = clientDoc.name || clientName;
            clientEmail = clientDoc.email || clientEmail;
          }
        } catch {}
      }
      return {
        _id: order._id.toString(),
        orderId: order.orderId,
        service: order.service,
        serviceName: order.serviceName || order.service,
        price: Number(order.price) || 0,
        amount: Number(order.amount) || 0,
        discount: Number(order.discount) || 0,
        payment: order.payment || "Pending",
        status: order.status || "Pending",
        clientName,
        clientEmail,
        createdAt: order.createdAt,
      };
    })
  );

  return {
    tab: "orders",
    items: enrichedOrders,
    pagination: {
      currentPage: parsedPage,
      totalPages: Math.ceil(totalFilteredOrders / parsedLimit) || 1,
      totalItems: totalFilteredOrders,
      limit: parsedLimit,
      hasNext: parsedPage * parsedLimit < totalFilteredOrders,
      hasPrev: parsedPage > 1,
      start: totalFilteredOrders === 0 ? 0 : skip + 1,
      end: Math.min(skip + parsedLimit, totalFilteredOrders),
    },
    summary,
  };
};

/**
 * Fetch counts and financial metrics in parallel across collections with previous period comparison.
 * Supports optional custom startDate and endDate strings (e.g. "2026-10-02" or ISO format).
 */
export const getLatestDashboardStats = async (customStart, customEnd) => {
  const { currentStart, currentEnd, prevStart, prevEnd, periodLabel, isCustom } =
    parsePeriodDates(customStart, customEnd);

  const [
    // Registered users
    totalUsers,
    prevUsers,

    // Orders
    currentOrders,
    prevOrders,

    // Assigned projects
    currentAssignedProjects,
    prevAssignedProjects,

    // Pending projects
    currentPendingProjects,
    prevPendingProjects,

    // Standalone expenses
    currentStandaloneExpenses,
    prevStandaloneExpenses,
    allTimeStandaloneExpenses,

    // Order costs / expenses
    currentOrderCosts,
    prevOrderCosts,
    allTimeOrderCosts,

    // Income / Revenue
    currentIncome,
    prevIncome,
    allTimeIncome,
  ] = await Promise.all([
    // Total registered users across all time
    userCollection.countDocuments(),
    // Registered users created before current period
    userCollection.countDocuments({
      $or: [
        { createdAt: { $lt: currentStart } },
        { createdAt: { $exists: false } },
      ],
    }),

    // Current period orders
    orderCollection.countDocuments({
      createdAt: { $gte: currentStart, $lte: currentEnd },
    }),
    // Previous period orders
    orderCollection.countDocuments({
      createdAt: { $gte: prevStart, $lte: prevEnd },
    }),

    // Overall total assigned projects (all time)
    orderCollection.countDocuments({
      assignedTo: { $exists: true, $ne: null, $nin: ["", null] },
    }),
    // Previous assigned projects count
    orderCollection.countDocuments({
      createdAt: { $lt: currentStart },
      assignedTo: { $exists: true, $ne: null, $nin: ["", null] },
    }),

    // Overall total pending projects (all time)
    orderCollection.countDocuments({
      $or: [
        { status: "Pending" },
        { assignedTo: null },
        { assignedTo: { $exists: false } },
        { assignedTo: "" },
      ],
    }),
    // Previous pending projects count
    orderCollection.countDocuments({
      createdAt: { $lt: currentStart },
      $or: [
        { status: "Pending" },
        { assignedTo: null },
        { assignedTo: { $exists: false } },
        { assignedTo: "" },
      ],
    }),

    // Standalone expenses
    getStandaloneExpenses(currentStart, currentEnd),
    getStandaloneExpenses(prevStart, prevEnd),
    getStandaloneExpenses(),

    // Order costs
    getOrderCosts(currentStart, currentEnd),
    getOrderCosts(prevStart, prevEnd),
    getOrderCosts(),

    // Income
    getIncome(currentStart, currentEnd),
    getIncome(prevStart, prevEnd),
    getIncome(),
  ]);

  // Combined Total Expenses = Standalone Expenses + Order Project Costs
  const currentTotalExpenses =
    currentStandaloneExpenses.total + currentOrderCosts.total;
  const prevTotalExpenses =
    prevStandaloneExpenses.total + prevOrderCosts.total;
  const allTimeTotalExpenses =
    allTimeStandaloneExpenses.total + allTimeOrderCosts.total;

  // Net Profit / Loss = Total Income - Total Expenses
  const currentProfit = currentIncome - currentTotalExpenses;
  const prevProfit = prevIncome - prevTotalExpenses;
  const allTimeProfit = allTimeIncome - allTimeTotalExpenses;

  // Metric trend calculation
  const userStats = calculateMetricStats(totalUsers, prevUsers);
  const incomeStats = calculateMetricStats(currentIncome, prevIncome);
  const expensesStats = calculateMetricStats(
    currentTotalExpenses,
    prevTotalExpenses,
  );
  const profitStats = calculateMetricStats(currentProfit, prevProfit);

  return {
    // Financial Metrics
    income: {
      ...incomeStats,
      allTime: Math.round(allTimeIncome),
    },
    expenses: {
      ...expensesStats,
      amount: Math.round(currentTotalExpenses),
      standalone: Math.round(currentStandaloneExpenses.total),
      orderCosts: Math.round(currentOrderCosts.total),
      allTime: Math.round(allTimeTotalExpenses),
      allTimeStandalone: Math.round(allTimeStandaloneExpenses.total),
      allTimeOrderCosts: Math.round(allTimeOrderCosts.total),
      count: currentStandaloneExpenses.count + currentOrderCosts.count,
    },
    profit: {
      ...profitStats,
      isProfit: currentProfit >= 0,
      margin:
        currentIncome > 0
          ? Number(((currentProfit / currentIncome) * 100).toFixed(1))
          : 0,
      allTime: Math.round(allTimeProfit),
      allTimeIsProfit: allTimeProfit >= 0,
      allTimeMargin:
        allTimeIncome > 0
          ? Number(((allTimeProfit / allTimeIncome) * 100).toFixed(1))
          : 0,
    },

    // Operational Metrics (kept intact for backward compatibility)
    users: userStats,
    registeredUsers: userStats,
    customers: userStats,
    orders: calculateMetricStats(currentOrders, prevOrders),
    assignedProjects: calculateMetricStats(
      currentAssignedProjects,
      prevAssignedProjects,
    ),
    pendingProjects: calculateMetricStats(
      currentPendingProjects,
      prevPendingProjects,
    ),
    dateRange: {
      startDate: currentStart.toISOString(),
      endDate: currentEnd.toISOString(),
      label: periodLabel,
      isCustom,
    },
    breakdown: { orders: [], expenses: [], orderCosts: [] },
    updatedAt: new Date().toISOString(),
  };
};

/**
 * Broadcasts fresh dashboard stats to all connected admin clients in real-time.
 * Can be called after any order, customer, project assignment, or expense change.
 */
export const broadcastDashboardStats = async () => {
  try {
    const stats = await getLatestDashboardStats();
    io.to(ADMIN_ROOM).emit("dashboardStatsUpdate", stats);
    io.to(ADMIN_ROOM).emit("chartDataUpdate");
    return stats;
  } catch (error) {
    console.error("Broadcast dashboard stats error:", error);
  }
};

