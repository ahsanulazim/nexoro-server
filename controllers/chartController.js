import client from "../config/db.js";

const orderCollection = client.db("nexoro").collection("Orders");
const expenseCollection = client.db("nexoro").collection("expenses");

/**
 * Controller: Get aggregated revenue, expense, and order chart analytics
 * GET /analytics/revenueChart?range=1month|6month|1year&startDate=...&endDate=...
 */
export const revenueChart = async (req, res) => {
  try {
    const range = (req.query.range || "1month").toLowerCase();
    const { startDate: qStart, endDate: qEnd } = req.query;
    const now = new Date();

    let startDate;
    let endDate = new Date(now);
    let mongoFormat = "%Y-%m-%d";
    let buckets = [];

    if (qStart) {
      // Custom date or date range
      const startStr = String(qStart).includes("T")
        ? qStart
        : `${qStart}T00:00:00.000+06:00`;
      const endTarget = qEnd || qStart;
      const endStr = String(endTarget).includes("T")
        ? endTarget
        : `${endTarget}T23:59:59.999+06:00`;

      startDate = new Date(startStr);
      endDate = new Date(endStr);
      if (isNaN(startDate.getTime())) startDate = new Date(qStart);
      if (isNaN(endDate.getTime())) endDate = new Date(endTarget);

      const diffMs = Math.max(1, endDate.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        // Single day: generate 3-hour interval buckets
        mongoFormat = "%Y-%m-%d-%H";
        const year = startDate.getFullYear();
        const month = String(startDate.getMonth() + 1).padStart(2, "0");
        const day = String(startDate.getDate()).padStart(2, "0");
        const datePrefix = `${year}-${month}-${day}`;

        for (let h = 0; h < 24; h += 3) {
          const hourStr = String(h).padStart(2, "0");
          const key = `${datePrefix}-${hourStr}`;
          const ampm = h >= 12 ? "PM" : "AM";
          const displayHour = h % 12 === 0 ? 12 : h % 12;
          const name = `${displayHour} ${ampm}`;
          buckets.push({ key, name, hour: h, datePrefix });
        }
      } else if (diffDays <= 62) {
        // Daily intervals
        mongoFormat = "%Y-%m-%d";
        let cur = new Date(startDate);
        cur.setHours(0, 0, 0, 0);
        const endMidnight = new Date(endDate);
        endMidnight.setHours(23, 59, 59, 999);

        while (cur <= endMidnight) {
          const year = cur.getFullYear();
          const month = String(cur.getMonth() + 1).padStart(2, "0");
          const day = String(cur.getDate()).padStart(2, "0");
          const key = `${year}-${month}-${day}`;
          const name = cur.toLocaleDateString("en-US", {
            month: "short",
            day: "2-digit",
            timeZone: "Asia/Dhaka",
          });
          buckets.push({ key, name });
          cur.setDate(cur.getDate() + 1);
        }
      } else {
        // Monthly intervals
        mongoFormat = "%Y-%m";
        let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

        while (cur <= endMonth) {
          const year = cur.getFullYear();
          const month = String(cur.getMonth() + 1).padStart(2, "0");
          const key = `${year}-${month}`;
          const name = cur.toLocaleDateString("en-US", {
            month: "short",
            year: "2-digit",
            timeZone: "Asia/Dhaka",
          });
          buckets.push({ key, name });
          cur.setMonth(cur.getMonth() + 1);
        }
      }
    } else if (range === "6month" || range === "6m") {
      // Last 6 months (from the 1st day of 5 months ago to end of current month)
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      mongoFormat = "%Y-%m";

      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const key = `${year}-${month}`;
        const name = d.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
          timeZone: "Asia/Dhaka",
        });
        buckets.push({ key, name });
      }
    } else if (range === "1year" || range === "1y" || range === "12month") {
      // Last 12 months (from the 1st day of 11 months ago to end of current month)
      startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      mongoFormat = "%Y-%m";

      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const key = `${year}-${month}`;
        const name = d.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
          timeZone: "Asia/Dhaka",
        });
        buckets.push({ key, name });
      }
    } else {
      // Default: 1month (Last 30 days)
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      mongoFormat = "%Y-%m-%d";

      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const key = `${year}-${month}-${day}`;
        const name = d.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          timeZone: "Asia/Dhaka",
        });
        buckets.push({ key, name });
      }
    }

    // 1. Order earnings, dues, and counts aggregation
    const chartData = await orderCollection
      .aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $project: {
            createdAt: 1,
            status: 1,
            payment: 1,
            amountNum: {
              $convert: {
                input: "$amount",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
            priceNum: {
              $convert: {
                input: { $ifNull: ["$servicePrice", "$price"] },
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
            discountNum: {
              $convert: {
                input: "$discount",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: mongoFormat,
                date: "$createdAt",
                timezone: "+06:00",
              },
            },
            orders: { $sum: 1 },
            earnings: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$status", "Cancelled"] },
                      {
                        $or: [
                          { $eq: ["$payment", "Success"] },
                          { $eq: ["$payment", "Partial"] },
                        ],
                      },
                    ],
                  },
                  "$amountNum",
                  0,
                ],
              },
            },
            dues: {
              $sum: {
                $cond: [
                  { $ne: ["$status", "Cancelled"] },
                  {
                    $cond: [
                      { $eq: ["$payment", "Partial"] },
                      {
                        $max: [
                          0,
                          {
                            $subtract: [
                              { $subtract: ["$priceNum", "$discountNum"] },
                              "$amountNum",
                            ],
                          },
                        ],
                      },
                      {
                        $cond: [
                          { $eq: ["$payment", "Success"] },
                          0,
                          {
                            $max: [
                              0,
                              { $subtract: ["$priceNum", "$discountNum"] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    // 2. Standalone expenses aggregation
    const standaloneExpenses = await expenseCollection
      .aggregate([
        {
          $project: {
            amountNum: {
              $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 },
            },
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
        {
          $group: {
            _id: {
              $dateToString: {
                format: mongoFormat,
                date: "$effectiveDate",
                timezone: "+06:00",
              },
            },
            total: { $sum: "$amountNum" },
          },
        },
      ])
      .toArray();

    // 3. Project order costs aggregation
    const orderCostsResult = await orderCollection
      .aggregate([
        {
          $match: { status: { $ne: "Cancelled" } },
        },
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
              {
                $match: { date: { $gte: startDate, $lte: endDate } },
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: mongoFormat,
                      date: "$date",
                      timezone: "+06:00",
                    },
                  },
                  total: { $sum: "$amount" },
                },
              },
            ],
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
                    { createdAt: { $gte: startDate, $lte: endDate } },
                  ],
                },
              },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: mongoFormat,
                      date: "$createdAt",
                      timezone: "+06:00",
                    },
                  },
                  total: { $sum: "$totalCost" },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const orderCostsFacet = orderCostsResult[0] || {};
    const costsFromArray = orderCostsFacet.fromCostsArray || [];
    const costsFromTotal = orderCostsFacet.fromTotalCostOnly || [];

    // Helper to find data for a bucket (including grouping nearby hours for single-day)
    const findMatchingSum = (arr, bucket) => {
      if (bucket.hour !== undefined) {
        // Single-day 3-hour bucket: match hours bucket.hour to bucket.hour + 2
        return arr.reduce((acc, curr) => {
          const parts = (curr._id || "").split("-");
          const h = parseInt(parts[parts.length - 1], 10);
          if (
            curr._id?.startsWith(bucket.datePrefix) &&
            h >= bucket.hour &&
            h < bucket.hour + 3
          ) {
            return acc + (Number(curr.total || curr.earnings || curr.orders || curr.dues) || 0);
          }
          return acc;
        }, 0);
      }
      const match = arr.find((item) => item._id === bucket.key);
      return match;
    };

    // Zero-filling missing buckets
    const finalData = buckets.map((bucket) => {
      let orders = 0;
      let earnings = 0;
      let dues = 0;
      let expenses = 0;

      if (bucket.hour !== undefined) {
        // For single-day 3-hour groups
        chartData.forEach((item) => {
          const parts = (item._id || "").split("-");
          const h = parseInt(parts[parts.length - 1], 10);
          if (
            item._id?.startsWith(bucket.datePrefix) &&
            h >= bucket.hour &&
            h < bucket.hour + 3
          ) {
            orders += Number(item.orders) || 0;
            earnings += Number(item.earnings) || 0;
            dues += Number(item.dues) || 0;
          }
        });

        standaloneExpenses.forEach((item) => {
          const parts = (item._id || "").split("-");
          const h = parseInt(parts[parts.length - 1], 10);
          if (
            item._id?.startsWith(bucket.datePrefix) &&
            h >= bucket.hour &&
            h < bucket.hour + 3
          ) {
            expenses += Number(item.total) || 0;
          }
        });

        costsFromArray.forEach((item) => {
          const parts = (item._id || "").split("-");
          const h = parseInt(parts[parts.length - 1], 10);
          if (
            item._id?.startsWith(bucket.datePrefix) &&
            h >= bucket.hour &&
            h < bucket.hour + 3
          ) {
            expenses += Number(item.total) || 0;
          }
        });

        costsFromTotal.forEach((item) => {
          const parts = (item._id || "").split("-");
          const h = parseInt(parts[parts.length - 1], 10);
          if (
            item._id?.startsWith(bucket.datePrefix) &&
            h >= bucket.hour &&
            h < bucket.hour + 3
          ) {
            expenses += Number(item.total) || 0;
          }
        });
      } else {
        const orderMatch = chartData.find((item) => item._id === bucket.key);
        orders = orderMatch ? Number(orderMatch.orders) || 0 : 0;
        earnings = orderMatch ? Math.round(Number(orderMatch.earnings) || 0) : 0;
        dues = orderMatch ? Math.round(Number(orderMatch.dues) || 0) : 0;

        const seMatch = standaloneExpenses.find((item) => item._id === bucket.key);
        const oc1Match = costsFromArray.find((item) => item._id === bucket.key);
        const oc2Match = costsFromTotal.find((item) => item._id === bucket.key);

        expenses = Math.round(
          (Number(seMatch?.total) || 0) +
            (Number(oc1Match?.total) || 0) +
            (Number(oc2Match?.total) || 0)
        );
      }

      return {
        key: bucket.key,
        name: bucket.name,
        orders,
        earnings: Math.round(earnings),
        dues: Math.round(dues),
        expenses: Math.round(expenses),
        netProfit: Math.round(earnings - expenses),
      };
    });

    const summary = {
      totalOrders: finalData.reduce((acc, curr) => acc + curr.orders, 0),
      totalEarnings: finalData.reduce((acc, curr) => acc + curr.earnings, 0),
      totalDues: finalData.reduce((acc, curr) => acc + curr.dues, 0),
      totalExpenses: finalData.reduce((acc, curr) => acc + curr.expenses, 0),
      netProfit: finalData.reduce(
        (acc, curr) => acc + (curr.earnings - curr.expenses),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      range: qStart ? "custom" : range,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      summary,
      data: finalData,
    });
  } catch (error) {
    console.error("Revenue chart error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
