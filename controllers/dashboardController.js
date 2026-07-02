import client from "../config/db.js";

const orderCollection = client.db("nexoro").collection("Orders");
const userCollection = client.db("nexoro").collection("Users");

export const analytics = async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const month = new Date().getMonth(); // 0-based

    // Current month range
    const currentStart = new Date(year, month, 1);
    const currentEnd = new Date(year, month + 1, 1);

    // Previous month range
    const prevStart = new Date(year, month - 1, 1);
    const prevEnd = new Date(year, month, 1);

    // Helper function
    const calculateStats = (orders) => {
      const total = orders.length;
      const pending = orders.filter((o) => o.status === "Pending").length;
      const completed = orders.filter((o) => o.status === "Completed").length;
      const cancelled = orders.filter((o) => o.status === "Cancelled").length;
      const totalAmount = orders.reduce((acc, o) => acc + o.price, 0);
      const pendingAmount = orders
        .filter((o) => o.payment === "Pending")
        .reduce((acc, o) => acc + o.amount, 0);
      const paidAmount = orders
        .filter((o) => o.payment === "Success")
        .reduce((acc, o) => acc + o.amount, 0);
      const cancelledAmount = orders
        .filter((o) => o.payment === "Failed")
        .reduce((acc, o) => acc + o.amount, 0);
      const dueAmount =
        orders
          .filter((o) => o.payment === "Partial")
          .reduce((acc, o) => acc + o.price, 0) -
        orders
          .filter((o) => o.payment === "Partial")
          .reduce((acc, o) => acc + o.amount, 0);
      const totalEarning =
        paidAmount +
        orders
          .filter((o) => o.payment === "Partial")
          .reduce((acc, o) => acc + o.amount, 0);

      return {
        total,
        pending,
        completed,
        cancelled,
        totalAmount,
        pendingAmount,
        paidAmount,
        cancelledAmount,
        dueAmount,
        totalEarning,
      };
    };

    // Current month orders
    const currentOrders = await orderCollection
      .find({ createdAt: { $gte: currentStart, $lt: currentEnd } })
      .toArray();

    // Previous month orders
    const prevOrders = await orderCollection
      .find({ createdAt: { $gte: prevStart, $lt: prevEnd } })
      .toArray();
    const users = await userCollection.countDocuments();
    const analytics = {
      current: calculateStats(currentOrders),
      previous: calculateStats(prevOrders),
      users,
    };

    res.status(200).json(analytics);
  } catch (error) {
    console.error("Analytics error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch analytics" });
  }
};
