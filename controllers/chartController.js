import client from "../config/db.js";

const orderCollection = client.db("nexoro").collection("Orders");

export const revenueChart = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const chartData = await orderCollection
      .aggregate([
        {
          $match: { createdAt: { $gte: sevenDaysAgo } },
        },
        {
          $group: {
            // এখানে format চেঞ্জ করে "%b %d" করা হয়েছে (যেমন: "Jul 01")
            _id: { $dateToString: { format: "%b %d", date: "$createdAt" } },
            orders: { $sum: 1 },
            earnings: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$payment", "Success"] },
                      { $eq: ["$payment", "Partial"] },
                    ],
                  },
                  "$amount",
                  0,
                ],
              },
            },
            dues: {
              $sum: {
                $cond: [
                  { $eq: ["$payment", "Partial"] },
                  { $subtract: ["$price", "$amount"] },
                  { $cond: [{ $eq: ["$payment", "Success"] }, 0, "$price"] },
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            name: "$_id",
            orders: 1,
            earnings: 1,
            dues: 1,
          },
        },
      ])
      .toArray();

    // জিরো-ফিলিং এবং লোকাল ফরম্যাটিং লজিক
    const finalData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);

      // পিওর জেএস দিয়ে "Jul 01" ফরম্যাট জেনারেট
      const dateStr = d.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
      });

      const found = chartData.find((item) => item.name === dateStr);
      if (found) {
        finalData.push(found);
      } else {
        finalData.push({ name: dateStr, orders: 0, earnings: 0, dues: 0 });
      }
    }

    res.json(finalData);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error.message });
  }
};
