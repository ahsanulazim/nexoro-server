import { io } from "../socket/socket.js";
import client from "../config/db.js";

const userCollection = client.db("nexoro").collection("Users");
const clientCollection = client.db("nexoro").collection("Clients");
const orderCollection = client.db("nexoro").collection("Orders");
const expenseCollection = client.db("nexoro").collection("expenses");

const ADMIN_ROOM = "admin_global_room";

/**
 * Helper to calculate percentage increase or decrease compared to previous month.
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
  const match = {};
  if (startDate && endDate) {
    match.createdAt = { $gte: startDate, $lt: endDate };
  } else if (endDate) {
    match.createdAt = { $lt: endDate };
  }

  const result = await expenseCollection
    .aggregate([
      { $match: match },
      {
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
      },
    ])
    .toArray();

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
            ? [{ $match: { date: { $gte: startDate, $lt: endDate } } }]
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
            ? [{ $match: { createdAt: { $gte: startDate, $lt: endDate } } }]
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
    match.createdAt = { $gte: startDate, $lt: endDate };
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
 * Fetch counts and financial metrics in parallel across collections with previous month comparison.
 */
export const getLatestDashboardStats = async () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  // Current month date boundaries
  const currentStart = new Date(year, month, 1);
  const currentEnd = new Date(year, month + 1, 1);

  // Previous month date boundaries
  const prevStart = new Date(year, month - 1, 1);
  const prevEnd = new Date(year, month, 1);

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
    // Registered users created before current month
    userCollection.countDocuments({
      $or: [
        { createdAt: { $lt: currentStart } },
        { createdAt: { $exists: false } },
      ],
    }),

    // Current month orders
    orderCollection.countDocuments({
      createdAt: { $gte: currentStart, $lt: currentEnd },
    }),
    // Previous month orders
    orderCollection.countDocuments({
      createdAt: { $gte: prevStart, $lt: prevEnd },
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

