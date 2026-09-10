import { ObjectId } from "mongodb";
import admin from "../admin/firebase.config.js";
import client from "../config/db.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";
import { broadcastDashboardStats } from "../utils/dashboardHelper.js";
import { convertToBDT } from "../utils/currencyHelper.js";

const orderCollection = client.db("nexoro").collection("Orders");
const orderCounterCollection = client.db("nexoro").collection("Counters");
const serviceCollection = client.db("nexoro").collection("Services");
const countriesCollection = client.db("nexoro").collection("Countries");
const clientCollection = client.db("nexoro").collection("Clients");
const teamCollection = client.db("nexoro").collection("Team");
const userCollection = client.db("nexoro").collection("Users");

// Helper: Generate unique orderId using counters collection
export const getNextOrderId = async () => {
  const counter = await orderCounterCollection.findOneAndUpdate(
    { _id: "orderCounter" },
    { $inc: { sequenceValue: 1 } },
    { returnDocument: "after", upsert: true },
  );
  const seq = counter?.sequenceValue ?? counter?.value?.sequenceValue ?? 1;
  return `ORD-${seq}`;
};

//create order

export const createOrder = async (req, res) => {
  const {
    clientId,
    slug,
    planId,
    serviceName,
    servicePrice,
    discount,
    payment,
    paymentMethod,
    amount,
  } = req.body;

  try {
    const orderId = await getNextOrderId();

    let price = 0;
    let serviceTitle = slug;
    let discountNum = 0;
    let amountNum = 0;

    if (slug === "custom") {
      // Custom service: direct BDT, no conversion needed
      price = Number(servicePrice) || 0;
      serviceTitle = serviceName || "Custom Service";
      discountNum = Number(discount) || 0;
      amountNum =
        payment === "Success" ? price - discountNum : Number(amount) || 0;
    } else {
      // Predefined plans: USD prices, convert to BDT
      const serviceData = await serviceCollection.findOne({ slug });
      const planData = serviceData?.plans?.find(
        (plan) => plan.id?.toString() === planId?.toString(),
      );
      const planPriceUSD = Number(planData?.price) || 0;
      price = await convertToBDT(planPriceUSD);
      serviceTitle = serviceData?.title || slug;

      discountNum = Number(discount)
        ? await convertToBDT(Number(discount))
        : 0;

      amountNum =
        payment === "Success"
          ? price - discountNum
          : Number(amount)
            ? await convertToBDT(Number(amount))
            : 0;
    }

    const order = await orderCollection.insertOne({
      clientId,
      orderId,
      service: slug,
      serviceName: slug === "custom" ? serviceName : undefined,
      servicePrice: slug === "custom" ? price : undefined,
      planId: slug === "custom" ? null : planId,
      price,
      discount: discountNum,
      status: "Pending",
      createdBy: "Admin",
      assignedTo: null,
      tasks: [],
      amount: amountNum,
      payment,
      paymentMethod,
      createdAt: new Date(),
    });

    // Send admin notification
    await createAndSendNotification({
      type: "new_order",
      title: "New Order Placed",
      message: `Order ${orderId} has been created for ${serviceTitle}.`,
      link: "/dashboard/orders",
    });

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).send({ success: true, order });
  } catch (error) {
    console.error("Order error:", error);
    return res
      .status(500)
      .send({ success: false, message: "Failed to create order" });
  }
};

export const confirmOrder = async (req, res) => {
  const { uid, slug, planId } = req.query;

  try {
    const orderId = await getNextOrderId();

    const service = await serviceCollection.findOne({
      slug,
    });

    const plan = service?.plans.find((plan) => plan.id.toString() === planId);
    const planPriceUSD = Number(plan?.price) || 0;
    const convertedPrice = await convertToBDT(planPriceUSD);
    const paidAmount = Number(req.paymentData?.TotalAmount) || convertedPrice;
    const finalPrice = convertedPrice || paidAmount;

    const order = await orderCollection.insertOne({
      uid,
      orderId,
      service: slug,
      planId,
      price: finalPrice,
      status: "Pending",
      createdBy: "User",
      assignedTo: null,
      tasks: [],
      payment: req.paymentData?.Status || "Pending",
      paymentMethod: req.paymentData?.FinancialEntity,
      amount: paidAmount,
      epsData: req.paymentData || null,
      createdAt: new Date(),
    });

    // Send admin notification
    await createAndSendNotification({
      type: "new_order",
      title: "New Order Placed",
      message: `Order ${orderId} has been placed by a customer.`,
      link: "/dashboard/orders",
    });

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).send({ success: true, orderId: order.insertedId });
  } catch (error) {
    console.error("Order error:", error);
    return res
      .status(500)
      .send({ success: false, message: "Failed to create order" });
  }
};

//get all orders
export const getAllOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { status, search } = req.query;

    const query = {};

    // Status filter
    if (status && status.toLowerCase() !== "all") {
      query.status = { $regex: new RegExp(`^${status.trim()}$`, "i") };
    }

    // Search filter
    if (search && search.trim()) {
      const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escapedSearch, "i");

      // Match clients by name, email, company
      const matchingClients = await clientCollection
        .find({
          $or: [
            { name: { $regex: searchRegex } },
            { email: { $regex: searchRegex } },
            { company: { $regex: searchRegex } },
          ],
        })
        .project({ _id: 1 })
        .toArray();
      const matchingClientIds = matchingClients.map((c) => c._id.toString());

      // Match services by title or slug
      const matchingServices = await serviceCollection
        .find({
          $or: [
            { title: { $regex: searchRegex } },
            { slug: { $regex: searchRegex } },
          ],
        })
        .project({ slug: 1 })
        .toArray();
      const matchingServiceSlugs = matchingServices.map((s) => s.slug);

      const orConditions = [
        { orderId: { $regex: searchRegex } },
        { service: { $regex: searchRegex } },
        { serviceName: { $regex: searchRegex } },
        { clientName: { $regex: searchRegex } },
        { createdBy: { $regex: searchRegex } },
        { payment: { $regex: searchRegex } },
        { paymentMethod: { $regex: searchRegex } },
        { "epsData.CustomerName": { $regex: searchRegex } },
        { "epsData.CustomerEmail": { $regex: searchRegex } },
        { "epsData.CustomerPhone": { $regex: searchRegex } },
      ];

      if (matchingClientIds.length > 0) {
        orConditions.push({ clientId: { $in: matchingClientIds } });
      }
      if (matchingServiceSlugs.length > 0) {
        orConditions.push({ service: { $in: matchingServiceSlugs } });
      }
      if (ObjectId.isValid(search.trim())) {
        orConditions.push({ _id: new ObjectId(search.trim()) });
      }

      query.$or = orConditions;
    }

    // Total orders matching query
    const totalOrders = await orderCollection.countDocuments(query);
    const totalAllOrders = await orderCollection.countDocuments();

    // Group counts for status tabs
    const statusGroups = await orderCollection
      .aggregate([
        {
          $group: {
            _id: { $toLower: { $ifNull: ["$status", "pending"] } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const statusCounts = {
      all: totalAllOrders,
      completed: 0,
      processing: 0,
      pending: 0,
      cancelled: 0,
    };

    statusGroups.forEach((g) => {
      const key = g._id;
      if (key in statusCounts) {
        statusCounts[key] = g.count;
      }
    });

    const orders = await orderCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const enrichedOrders = await Promise.all(
      orders.map(async (order) => {
        // Firebase থেকে user info
        let userRecord = null;
        if (order.uid) {
          userRecord = await admin.auth().getUser(order.uid);
        } else if (order.clientId) {
          const client = await clientCollection.findOne({
            _id: new ObjectId(order.clientId),
          });
          userRecord = { name: client?.name, email: client?.email };
        }
        let userName =
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
          // Service info
          const service = await serviceCollection.findOne({
            slug: order.service,
          });
          if (service) {
            serviceTitle = service.title;
            const plan = service.plans?.find(
              (p) => p.id?.toString() === order.planId?.toString(),
            );
            planName = plan?.planName || null;
            planPrice = order.price ?? Number(plan?.price) ?? 0;
          }
        }

        //assigned member
        let member = null;
        if (order.assignedTo) {
          if (ObjectId.isValid(order.assignedTo)) {
            const userDoc = await userCollection.findOne({
              _id: new ObjectId(order.assignedTo),
            });
            if (userDoc) {
              member = {
                memberName: userDoc.name || userDoc.displayName || userDoc.email,
                email: userDoc.email,
                role: userDoc.role,
              };
            } else {
              member = await teamCollection.findOne({
                _id: new ObjectId(order.assignedTo),
              });
            }
          }
        }

        const effectivePrice = Number(planPrice) || 0;
        const discountVal = Number(order.discount) || 0;
        const amountVal = Number(order.amount) || 0;
        const dueAmount = effectivePrice - discountVal - amountVal;

        return {
          orderId: order._id.toString(),
          orderUid: order.orderId,
          userName: userName || order.epsData?.customerName || order.clientName,
          serviceTitle,
          planName,
          price: effectivePrice,
          amount: order.amount,
          dueAmount: dueAmount > 0 ? dueAmount : 0,
          assignedTo: order.assignedTo,
          assignedMember: member?.memberName || null,
          tasks: order.tasks || [],
          costs: order.costs || [],
          totalCost:
            order.totalCost ??
            (order.costs?.reduce((a, b) => a + (Number(b.amount) || 0), 0) || 0),
          createdBy: order.createdBy,
          payment: order.payment,
          paymentMethod: order.paymentMethod,
          status: order.status || "Pending",
          createdAt: order.createdAt,
        };
      }),
    );
    res.status(200).json({
      success: true,
      orders: enrichedOrders,
      statusCounts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        limit,
        hasNext: page * limit < totalOrders,
        hasPrev: page > 1,
        start: totalOrders === 0 ? 0 : skip + 1,
        end: Math.min(skip + limit, totalOrders),
      },
    });
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
};

//get order by id
export const getOrder = async (req, res) => {
  const { id } = req.query;

  try {
    const order = await orderCollection.findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    let user = {};
    if (order.uid) {
      const userRecord = await admin.auth().getUser(order.uid);
      user = { name: userRecord.displayName, email: userRecord.email };
    } else if (order.clientId) {
      const client = await clientCollection.findOne({
        _id: new ObjectId(order.clientId),
      });
      user = { name: client?.name, email: client?.email };
    }

    let service = null;
    let plan = null;

    if (order.service === "custom") {
      service = {
        title: order.serviceName || "Custom Service",
        slug: "custom",
      };
      plan = {
        id: "custom",
        planName: "Custom Plan",
        price: order.servicePrice || order.price || 0,
      };
    } else {
      service = await serviceCollection.findOne({ slug: order.service });
      const rawPlan = service
        ? service.plans?.find(
            (p) => p.id?.toString() === order.planId?.toString(),
          )
        : null;
      plan = rawPlan
        ? {
            ...rawPlan,
            price: order.price ?? rawPlan.price,
            planPriceUSD: rawPlan.price,
          }
        : null;
    }

    let member = {};
    if (order.assignedTo) {
      if (ObjectId.isValid(order.assignedTo)) {
        const userDoc = await userCollection.findOne({
          _id: new ObjectId(order.assignedTo),
        });
        if (userDoc) {
          member = {
            _id: userDoc._id,
            memberName: userDoc.name || userDoc.displayName || userDoc.email,
            email: userDoc.email,
            role: userDoc.role,
          };
        } else {
          const teamMember = await teamCollection.findOne({
            _id: new ObjectId(order.assignedTo),
          });
          if (teamMember) {
            member = teamMember;
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      order: {
        ...order,
        costs: order.costs || [],
        totalCost:
          order.totalCost ??
          (order.costs?.reduce((a, b) => a + (Number(b.amount) || 0), 0) || 0),
        user,
        service,
        plan,
        assignedMember: member?.memberName || "Not Assigned",
      },
    });
  } catch (error) {
    console.error("Get order error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch order" });
  }
};

//update order
export const updateOrder = async (req, res) => {
  const { orderId } = req.query;
  const {
    uid,
    clientId,
    slug,
    planId,
    serviceName,
    servicePrice,
    discount,
    status,
    amount,
    payment,
    paymentMethod,
  } = req.body;

  try {
    const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    let price = order.price || 0;
    if (slug === "custom") {
      price = Number(servicePrice) || order.price || 0;
    } else if (slug) {
      const serviceData = await serviceCollection.findOne({ slug });
      const planData = serviceData?.plans?.find(
        (plan) => plan.id?.toString() === planId?.toString(),
      );
      if (planData?.price) {
        price = await convertToBDT(Number(planData.price));
      }
    }

    const discountNum = Number(discount) || 0;
    const amountNum = Number(amount) || 0;

    const updateDoc = {
      ...(uid && { uid }),
      ...(clientId && { clientId }),
      service: slug,
      planId: slug === "custom" ? null : planId,
      serviceName: slug === "custom" ? serviceName : null,
      servicePrice: slug === "custom" ? price : null,
      price,
      discount: discountNum,
      status,
      amount: amountNum,
      payment,
      paymentMethod,
    };

    const result = await orderCollection.updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: updateDoc,
      },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Trigger notification if status changed
    if (status && status !== order.status) {
      if (status === "Completed") {
        await createAndSendNotification({
          type: "order_completed",
          title: "Order Completed",
          message: `Order ${order.orderId} has been marked as Completed.`,
          link: "/dashboard/orders",
        });
      } else if (status === "Cancelled") {
        await createAndSendNotification({
          type: "order_cancelled",
          title: "Order Cancelled",
          message: `Order ${order.orderId} has been Cancelled.`,
          link: "/dashboard/orders",
        });
      }
    }

    // Trigger notification if payment status changed
    if (payment && payment !== order.payment) {
      if (payment === "Success") {
        await createAndSendNotification({
          type: "payment_completed",
          title: "Payment Completed",
          message: `Payment of BDT ${amountNum || order.amount || 0} received for order ${order.orderId}.`,
          link: "/dashboard/orders",
        });
      } else if (payment === "Pending") {
        await createAndSendNotification({
          type: "payment_due",
          title: "Payment Due",
          message: `Payment status updated to Pending for order ${order.orderId}.`,
          link: "/dashboard/orders",
        });
      }
    }

    // Real-time broadcast for dashboard stats & charts
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).json({ success: true, message: "Order updated" });
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({ success: false, message: "Failed to update order" });
  }
};

//update order status
export const updateOrderStatus = async (req, res) => {
  const orderId = req.params.orderId || req.body.orderId;
  const { status } = req.body;
  try {
    if (!orderId || !ObjectId.isValid(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or missing order ID" });
    }

    const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const result = await orderCollection.updateOne(
      { _id: new ObjectId(orderId) },
      { $set: { status } },
    );
    if (result.modifiedCount === 0 && order.status === status) {
      return res.status(200).json({
        success: true,
        message: "Order status is already up to date",
      });
    }

    if (status === "Completed") {
      await createAndSendNotification({
        type: "order_completed",
        title: "Order Completed",
        message: `Order ${order.orderId} has been marked as Completed.`,
        link: "/dashboard/orders",
      });
    } else if (status === "Cancelled") {
      await createAndSendNotification({
        type: "order_cancelled",
        title: "Order Cancelled",
        message: `Order ${order.orderId} has been Cancelled.`,
        link: "/dashboard/orders",
      });
    }

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).json({ success: true, message: "Order status updated" });
  } catch (error) {
    console.error("Update order status error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to update order status" });
  }
};

//assign order to a member
export const assignOrderToMember = async (req, res) => {
  const { id } = req.query;
  const { assignedTo, tasks } = req.body;
  console.log(id, assignedTo, tasks);

  try {
    // Role check: Only admin can assign orders
    if (req.user?.email) {
      const caller = await userCollection.findOne({ email: req.user.email });
      if (caller && caller.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only administrators can assign orders",
        });
      }
    }

    const formattedTasks = Array.isArray(tasks)
      ? tasks
          .filter((t) => t?.task && t.task.trim() !== "")
          .map((t) => ({
            task: t.task.trim(),
            isCompleted: Boolean(t.isCompleted),
          }))
      : [];

    const updateDoc = {};
    if (assignedTo !== undefined) {
      updateDoc.assignedTo = assignedTo;
    }
    if (tasks !== undefined) {
      updateDoc.tasks = formattedTasks;
    }

    const result = await orderCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Real-time broadcast for dashboard stats (assigned vs pending projects updated)
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res
      .status(200)
      .json({ success: true, message: "Order assigned to member with tasks" });
  } catch (error) {
    console.error("Assign order to member error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to assign order to member" });
  }
};

// Update tasks for an order (add, edit, toggle complete, delete tasks)
export const updateOrderTasks = async (req, res) => {
  const id = req.query.id || req.body.orderId || req.params.orderId;
  const { tasks, assignedTo } = req.body;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  try {
    const order = await orderCollection.findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    let caller = null;
    if (req.user?.email) {
      caller = await userCollection.findOne({ email: req.user.email });
    }

    const isAdmin = caller?.role === "admin";
    const isMember = caller?.role === "member";

    // If caller is authenticated as member (non-admin)
    if (caller && !isAdmin) {
      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized to update tasks",
        });
      }

      // Verify this project is assigned to caller
      const callerIdStr = caller._id ? caller._id.toString() : "";
      const isAssignedToCaller =
        (order.assignedTo &&
          (order.assignedTo.toString() === callerIdStr ||
            order.assignedTo.toString() === caller.email ||
            order.assignedTo.toString().toLowerCase() ===
              (caller.name || "").toLowerCase())) ||
        (order.assignedMemberEmail &&
          order.assignedMemberEmail.toLowerCase() ===
            caller.email.toLowerCase());

      if (!isAssignedToCaller) {
        return res.status(403).json({
          success: false,
          message: "You can only update tasks for projects assigned to you",
        });
      }

      // Member cannot reassign
      if (
        assignedTo !== undefined &&
        String(assignedTo) !== String(order.assignedTo)
      ) {
        return res.status(403).json({
          success: false,
          message: "Only administrators can reassign projects",
        });
      }

      // Member can ONLY update isCompleted of existing tasks (cannot add/delete or change descriptions)
      if (tasks !== undefined) {
        const existingTasks = Array.isArray(order.tasks) ? order.tasks : [];
        if (tasks.length !== existingTasks.length) {
          return res.status(403).json({
            success: false,
            message:
              "Only administrators can add or delete tasks. Members can only update completion status.",
          });
        }

        // Only update isCompleted, preserving existing task text
        const safeTasks = existingTasks.map((orig, i) => ({
          task: orig.task,
          isCompleted: Boolean(tasks[i]?.isCompleted),
        }));

        await orderCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { tasks: safeTasks } },
        );

        broadcastDashboardStats().catch((err) =>
          console.error("Dashboard stats broadcast error:", err)
        );

        return res.status(200).json({
          success: true,
          message: "Task completion updated successfully",
          tasks: safeTasks,
        });
      }
    }

    // Admin or unrestricted update
    const updateDoc = {};

    if (tasks !== undefined) {
      const formattedTasks = Array.isArray(tasks)
        ? tasks
            .filter((t) => t?.task && String(t.task).trim() !== "")
            .map((t) => ({
              task: String(t.task).trim(),
              isCompleted: Boolean(t.isCompleted),
            }))
        : [];
      updateDoc.tasks = formattedTasks;
    }

    if (assignedTo !== undefined) {
      updateDoc.assignedTo = assignedTo;
    }

    const result = await orderCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).json({
      success: true,
      message: "Tasks updated successfully",
      tasks: updateDoc.tasks,
    });
  } catch (error) {
    console.error("Update order tasks error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order tasks",
    });
  }
};

// Update order/project costs
export const updateOrderCosts = async (req, res) => {
  const { costs } = req.body;
  const id = req.query.id || req.body.orderId;

  try {
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing order ID",
      });
    }

    const order = await orderCollection.findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    let caller = null;
    if (req.user?.email) {
      caller = await userCollection.findOne({ email: req.user.email });
    }

    const isAdmin = caller?.role === "admin";
    const isMember = caller?.role === "member";

    if (!isAdmin) {
      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized to update project costs",
        });
      }

      // Check if project is assigned to caller
      const callerIdStr = caller?._id ? caller._id.toString() : "";
      const isAssignedToCaller =
        (order.assignedTo &&
          (order.assignedTo.toString() === callerIdStr ||
            order.assignedTo.toString() === caller.email ||
            order.assignedTo.toString().toLowerCase() ===
              (caller.name || "").toLowerCase())) ||
        (order.assignedMemberEmail &&
          order.assignedMemberEmail.toLowerCase() ===
            (caller?.email || "").toLowerCase());

      if (!isAssignedToCaller) {
        return res.status(403).json({
          success: false,
          message: "You can only view and update costs for projects assigned to you",
        });
      }
    }

    // Format costs array
    const formattedCosts = Array.isArray(costs)
      ? costs
          .filter((c) => c && c.title && String(c.title).trim() !== "")
          .map((c) => ({
            id:
              c.id ||
              `cost_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            title: String(c.title).trim(),
            amount: Math.max(0, Number(c.amount) || 0),
            note: c.note ? String(c.note).trim() : "",
            date: c.date ? new Date(c.date) : new Date(),
            addedBy:
              c.addedBy ||
              caller?.name ||
              caller?.displayName ||
              caller?.email ||
              (isAdmin ? "Admin" : "Team Member"),
          }))
      : [];

    const totalCost = formattedCosts.reduce(
      (acc, curr) => acc + curr.amount,
      0,
    );

    await orderCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          costs: formattedCosts,
          totalCost: totalCost,
          updatedAt: new Date(),
        },
      },
    );

    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err),
    );

    res.status(200).json({
      success: true,
      message: "Costs updated successfully",
      costs: formattedCosts,
      totalCost,
    });
  } catch (error) {
    console.error("Update order costs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order costs",
    });
  }
};

//delete order
export const deleteOrder = async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await orderCollection.deleteOne({
      _id: new ObjectId(orderId),
    });
    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).json({ success: true, message: "Order deleted" });
  } catch (error) {
    console.error("Delete order error:", error);
    res.status(500).json({ success: false, message: "Failed to delete order" });
  }
};

export const getAllCountries = async (req, res) => {
  try {
    const countries = await countriesCollection.find({}).toArray();

    const formattedCountries = countries.map((country) => {
      return {
        value: country.countryCode,
        label: country.name,
      };
    });

    res.status(200).json({ success: true, countries: formattedCountries });
  } catch (error) {
    console.error("Get countries error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch countries" });
  }
};
