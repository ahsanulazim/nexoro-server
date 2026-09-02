import { io } from "../socket/socket.js";
import client from "../config/db.js";

const userCollection = client.db("nexoro").collection("Users");
const clientCollection = client.db("nexoro").collection("Clients");
const orderCollection = client.db("nexoro").collection("Orders");
const expenseCollection = client.db("nexoro").collection("expenses");

const ADMIN_ROOM = "admin_global_room";

/**
 * Helper to calculate percentage increase or decrease compared to previous month.
 * Requirements:
 * - Returns percentage capped at 100% (so never 300%, 400%, etc.)
 * - Positive or zero indicates increase, negative indicates decrease.
 * - Formatted with sign, numeric percentage, and direction flags.
 */
const calculateMetricStats = (currentCount, prevCount) => {
  let percentage = 0;
  let isIncrease = true;

  if (prevCount === 0) {
    // If there were no items last month and now there are, capped at 100%
    percentage = currentCount > 0 ? 100 : 0;
    isIncrease = currentCount >= 0;
  } else {
    const rawDiff = ((currentCount - prevCount) / prevCount) * 100;
    isIncrease = rawDiff >= 0;

    // Cap percentage between -100% and +100%
    const absDiff = Math.abs(rawDiff);
    const capped = Math.min(absDiff, 100);
    percentage = Number(capped.toFixed(1));
  }

  return {
    total: currentCount,
    previousMonth: prevCount,
    percentage, // e.g. 18.5 or 100 (never > 100)
    isIncrease, // true if increased / held, false if decreased
    trend: isIncrease ? "up" : "down",
    text: `${percentage}%`,
  };
};

/**
 * Fetch counts in parallel across collections with previous month comparison.
 * Scalable, indexed query filters, debug-friendly, bounded within 100%.
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
    // Current month counts
    customerCount,
    clientCount,
    currentOrders,
    currentAssignedProjects,
    currentPendingProjects,
    currentExpenses,

    // Previous month counts for comparison
    prevCustomerCount,
    prevClientCount,
    prevOrders,
    prevAssignedProjects,
    prevPendingProjects,
    prevExpenses,
  ] = await Promise.all([
    // Current month customers (role: 'customer' created in current month)
    userCollection.countDocuments({
      role: "customer",
      createdAt: { $gte: currentStart, $lt: currentEnd },
    }),
    // Current month clients (joined in current month)
    clientCollection.countDocuments({
      $or: [
        { joined: { $gte: currentStart, $lt: currentEnd } },
        { createdAt: { $gte: currentStart, $lt: currentEnd } },
      ],
    }),
    // Current month orders
    orderCollection.countDocuments({
      createdAt: { $gte: currentStart, $lt: currentEnd },
    }),
    // Overall total assigned projects (full count across all time)
    orderCollection.countDocuments({
      assignedTo: { $exists: true, $ne: null, $nin: ["", null] },
    }),
    // Overall total pending projects (full count across all time)
    orderCollection.countDocuments({
      $or: [
        { status: "Pending" },
        { assignedTo: null },
        { assignedTo: { $exists: false } },
        { assignedTo: "" },
      ],
    }),
    // Current month expenses
    expenseCollection.countDocuments({
      createdAt: { $gte: currentStart, $lt: currentEnd },
    }),

    // Previous month customers (role: 'customer' created in previous month)
    userCollection.countDocuments({
      role: "customer",
      createdAt: { $gte: prevStart, $lt: prevEnd },
    }),
    // Previous month clients (joined in previous month)
    clientCollection.countDocuments({
      $or: [
        { joined: { $gte: prevStart, $lt: prevEnd } },
        { createdAt: { $gte: prevStart, $lt: prevEnd } },
      ],
    }),
    // Previous month orders
    orderCollection.countDocuments({
      createdAt: { $gte: prevStart, $lt: prevEnd },
    }),
    // Previous assigned projects count (assigned projects created before current month)
    orderCollection.countDocuments({
      createdAt: { $lt: currentStart },
      assignedTo: { $exists: true, $ne: null, $nin: ["", null] },
    }),
    // Previous pending projects count (pending projects created before current month)
    orderCollection.countDocuments({
      createdAt: { $lt: currentStart },
      $or: [
        { status: "Pending" },
        { assignedTo: null },
        { assignedTo: { $exists: false } },
        { assignedTo: "" },
      ],
    }),
    // Previous month expenses
    expenseCollection.countDocuments({
      createdAt: { $gte: prevStart, $lt: prevEnd },
    }),
  ]);

  const activeCustomerCurrent =
    customerCount > 0 ? customerCount : clientCount;
  const activeCustomerPrev =
    prevCustomerCount > 0 ? prevCustomerCount : prevClientCount;

  return {
    customers: calculateMetricStats(activeCustomerCurrent, activeCustomerPrev),
    orders: calculateMetricStats(currentOrders, prevOrders),
    assignedProjects: calculateMetricStats(
      currentAssignedProjects,
      prevAssignedProjects,
    ),
    pendingProjects: calculateMetricStats(
      currentPendingProjects,
      prevPendingProjects,
    ),
    expenses: calculateMetricStats(currentExpenses, prevExpenses),
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
