import { ObjectId } from "mongodb";
import client from "../config/db.js";
import admin from "../admin/firebase.config.js";
import { getLatestDashboardStats } from "../utils/dashboardHelper.js";

const orderCollection = client.db("nexoro").collection("Orders");
const userCollection = client.db("nexoro").collection("Users");
const clientCollection = client.db("nexoro").collection("Clients");
const serviceCollection = client.db("nexoro").collection("Services");
const teamCollection = client.db("nexoro").collection("Team");

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

/**
 * Controller: Get real-time dashboard overview metrics
 * GET /dashboard/stats
 * Returns:
 *  - totalCustomers
 *  - totalOrders
 *  - assignedProjects
 *  - pendingProjects
 *  - totalExpenses
 *  - updatedAt
 */
export const getDashboardStats = async (req, res) => {
  try {
    const stats = await getLatestDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Dashboard metrics fetched successfully",
      data: stats,
    });
  } catch (error) {
    console.error("Get Dashboard Stats Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard statistics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Controller: Get most recent orders for dashboard
 * GET /dashboard/recent-orders
 * Query: ?limit=6 (default: 6)
 */
export const getRecentOrders = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;

    const orders = await orderCollection
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        let userRecord = null;
        if (order.uid) {
          try {
            userRecord = await admin.auth().getUser(order.uid);
          } catch {
            userRecord = null;
          }
          if (!userRecord) {
            try {
              const dbUser = await userCollection.findOne({ uid: order.uid });
              if (dbUser) {
                userRecord = { name: dbUser.name, email: dbUser.email };
              }
            } catch {}
          }
        } else if (order.clientId) {
          try {
            const clientDoc = await clientCollection.findOne({
              _id: new ObjectId(order.clientId),
            });
            userRecord = { name: clientDoc?.name, email: clientDoc?.email };
          } catch {}
        }

        const userName =
          userRecord?.displayName ||
          userRecord?.name ||
          order.epsData?.CustomerName ||
          order.clientName ||
          "Unknown User";

        let serviceTitle = order.service;
        let planName = null;
        let planPrice = order.price || 0;

        if (order.service === "custom") {
          serviceTitle = order.serviceName || "Custom Service";
          planName = "Custom Plan";
          planPrice = order.servicePrice || order.price || 0;
        } else {
          try {
            const service = await serviceCollection.findOne({
              slug: order.service,
            });
            if (service) {
              serviceTitle = service.title;
              const plan = service.plans?.find(
                (p) => p.id?.toString() === order.planId?.toString(),
              );
              planName = plan?.planName || null;
              planPrice = Number(plan?.price) || order.price || 0;
            }
          } catch {}
        }

        let member = null;
        if (order.assignedTo) {
          try {
            member = await teamCollection.findOne({
              _id: new ObjectId(order.assignedTo),
            });
          } catch {}
        }

        const effectivePrice = Number(planPrice) || 0;
        const discountVal = Number(order.discount) || 0;
        const amountVal = Number(order.amount) || 0;
        const dueAmount = effectivePrice - discountVal - amountVal;

        return {
          orderId: order._id.toString(),
          orderUid: order.orderId,
          userName,
          serviceTitle,
          planName,
          price: effectivePrice,
          amount: order.amount,
          dueAmount: dueAmount > 0 ? dueAmount : 0,
          assignedTo: order.assignedTo,
          assignedMember: member?.memberName || null,
          tasks: order.tasks || [],
          createdBy: order.createdBy,
          payment: order.payment,
          paymentMethod: order.paymentMethod,
          status: order.status || "Pending",
          createdAt: order.createdAt,
        };
      }),
    );

    return res.status(200).json({
      success: true,
      orders: enrichedOrders,
    });
  } catch (error) {
    console.error("Get recent orders error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch recent orders",
      error: error.message,
    });
  }
};

/**
 * Controller: Get most recent projects for dashboard
 * GET /dashboard/recent-projects
 * Query: ?limit=6 (default: 6)
 */
export const getRecentProjects = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;

    const projects = await orderCollection
      .aggregate([
        // Filter out orders where assignedTo is null, empty, or missing
        {
          $match: {
            assignedTo: { $ne: null, $exists: true, $nin: ["", null] },
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: limit },
        // Lookup service from Services collection by matching slug with order.service
        {
          $lookup: {
            from: "Services",
            localField: "service",
            foreignField: "slug",
            as: "serviceDoc",
          },
        },
        // Lookup team member from Team collection by matching _id with order.assignedTo
        {
          $lookup: {
            from: "Team",
            let: { assignedToId: "$assignedTo" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $ne: ["$$assignedToId", null] },
                      { $ne: ["$$assignedToId", ""] },
                      {
                        $eq: [
                          "$_id",
                          {
                            $convert: {
                              input: "$$assignedToId",
                              to: "objectId",
                              onError: null,
                              onNull: null,
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
            as: "teamMember",
          },
        },
        // Lookup client name from Clients collection (if clientId exists)
        {
          $lookup: {
            from: "Clients",
            let: { clientIdVal: "$clientId" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $ne: ["$$clientIdVal", null] },
                      { $ne: ["$$clientIdVal", ""] },
                      {
                        $eq: [
                          "$_id",
                          {
                            $convert: {
                              input: "$$clientIdVal",
                              to: "objectId",
                              onError: null,
                              onNull: null,
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  name: 1,
                },
              },
            ],
            as: "clientDoc",
          },
        },
        // Extract matched service, member, and client
        {
          $addFields: {
            matchedService: { $arrayElemAt: ["$serviceDoc", 0] },
            matchedMember: { $arrayElemAt: ["$teamMember", 0] },
            matchedClient: { $arrayElemAt: ["$clientDoc", 0] },
          },
        },
        // Extract matched plan from matchedService.plans matching planId
        {
          $addFields: {
            matchedPlan: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ["$matchedService.plans", []] },
                    as: "plan",
                    cond: {
                      $eq: [
                        { $toString: "$$plan.id" },
                        { $toString: "$planId" },
                      ],
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        // Project the final structure
        {
          $project: {
            _id: 1,
            orderId: 1,
            client: { $ifNull: ["$matchedClient.name", null] },
            planName: {
              $cond: {
                if: { $eq: ["$service", "custom"] },
                then: "Custom Plan",
                else: { $ifNull: ["$matchedPlan.planName", null] },
              },
            },
            serviceName: {
              $cond: {
                if: { $eq: ["$service", "custom"] },
                then: { $ifNull: ["$serviceName", "Custom Service"] },
                else: { $ifNull: ["$matchedService.title", "$service"] },
              },
            },
            servicePrice: {
              $cond: {
                if: { $eq: ["$service", "custom"] },
                then: {
                  $convert: {
                    input: { $ifNull: ["$servicePrice", "$price"] },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
                else: {
                  $convert: {
                    input: {
                      $ifNull: [
                        "$matchedPlan.price",
                        { $ifNull: ["$price", 0] },
                      ],
                    },
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
            price: 1,
            assignedTo: {
              $ifNull: ["$matchedMember.memberName", null],
            },
            status: { $ifNull: ["$status", "Pending"] },
            payment: 1,
            tasks: 1,
            createdBy: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ])
      .toArray();

    return res.status(200).json({ success: true, projects });
  } catch (error) {
    console.error("Get recent projects error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

