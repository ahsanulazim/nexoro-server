import client from "../config/db.js";

const orderCollection = client.db("nexoro").collection("Orders");

/**
 * Controller: Get aggregated revenue and order chart analytics
 * GET /analytics/revenueChart?range=1month | 6month | 1year
 */
export const revenueChart = async (req, res) => {
  try {
    const range = (req.query.range || "1month").toLowerCase();
    const now = new Date();

    let startDate;
    let endDate = new Date(now);
    let mongoFormat = "%Y-%m-%d";
    let buckets = [];

    if (range === "6month" || range === "6m") {
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
        });
        buckets.push({ key, name });
      }
    }

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
                input: "$price",
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

    // Zero-filling missing buckets
    const finalData = buckets.map((bucket) => {
      const match = chartData.find((item) => item._id === bucket.key);
      return {
        key: bucket.key,
        name: bucket.name,
        orders: match ? Number(match.orders) || 0 : 0,
        earnings: match ? Math.round(Number(match.earnings) || 0) : 0,
        dues: match ? Math.round(Number(match.dues) || 0) : 0,
      };
    });

    const summary = {
      totalOrders: finalData.reduce((acc, curr) => acc + curr.orders, 0),
      totalEarnings: finalData.reduce((acc, curr) => acc + curr.earnings, 0),
      totalDues: finalData.reduce((acc, curr) => acc + curr.dues, 0),
    };

    return res.status(200).json({
      success: true,
      range,
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
