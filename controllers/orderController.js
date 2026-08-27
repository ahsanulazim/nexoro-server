import { ObjectId } from "mongodb";
import admin from "../admin/firebase.config.js";
import client from "../config/db.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";

const orderCollection = client.db("nexoro").collection("Orders");
const orderCounterCollection = client.db("nexoro").collection("Counters");
const serviceCollection = client.db("nexoro").collection("Services");
const countriesCollection = client.db("nexoro").collection("Countries");
const clientCollection = client.db("nexoro").collection("Clients");
const teamCollection = client.db("nexoro").collection("Team");

// Helper: Generate unique orderId using counters collection
export const getNextOrderId = async () => {
  const counter = await orderCounterCollection.findOneAndUpdate(
    { _id: "orderCounter" },
    { $inc: { sequenceValue: 1 } },
    { returnDocument: "after", upsert: true },
  );
  const seq = counter.sequenceValue;
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ORD-${datePart}-${seq}`;
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

    if (slug === "custom") {
      price = Number(servicePrice) || 0;
      serviceTitle = serviceName || "Custom Service";
    } else {
      const serviceData = await serviceCollection.findOne({ slug });
      const planData = serviceData?.plans?.find(
        (plan) => plan.id?.toString() === planId?.toString(),
      );
      price = Number(planData?.price) || 0;
      serviceTitle = serviceData?.title || slug;
    }

    const discountNum = Number(discount) || 0;
    const amountNum =
      payment === "Success" ? price - discountNum : Number(amount) || 0;

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

    const order = await orderCollection.insertOne({
      uid,
      orderId,
      service: slug,
      planId,
      price: Number(plan?.price),
      status: "Pending",
      createdBy: "User",
      assignedTo: null,
      tasks: [],
      payment: req.paymentData.Status || "Pending",
      paymentMethod: req.paymentData.FinancialEntity,
      amount: Number(plan?.price),
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
    // query থেকে page number নাও, default 1
    const page = parseInt(req.query.page) || 1;
    const limit = 12; // প্রতি পেজে 12টা order
    const skip = (page - 1) * limit;

    // মোট order count বের করো
    const totalOrders = await orderCollection.countDocuments();

    const orders = await orderCollection
      .find()
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
            planPrice = Number(plan?.price) || order.price || 0;
          }
        }

        //assigned member
        let member = null;
        if (order.assignedTo) {
          member = await teamCollection.findOne({
            _id: new ObjectId(order.assignedTo),
          });
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
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        hasNext: page * limit < totalOrders,
        hasPrev: page > 1,
        start: skip + 1,
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
      plan = service
        ? service.plans?.find(
            (p) => p.id?.toString() === order.planId?.toString(),
          )
        : null;
    }

    let member = {};
    if (order.assignedTo) {
      member = await teamCollection.findOne({
        _id: new ObjectId(order.assignedTo),
      });
    }

    res.status(200).json({
      success: true,
      order: {
        ...order,
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
        price = Number(planData.price);
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

    res.status(200).json({ success: true, message: "Order updated" });
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({ success: false, message: "Failed to update order" });
  }
};

//update order status
export const updateOrderStatus = async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  try {
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
    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found or status unchanged",
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
    const formattedTasks = Array.isArray(tasks)
      ? tasks
          .filter((t) => t?.task && t.task.trim() !== "")
          .map((t) => ({
            task: t.task.trim(),
            isCompleted: false,
          }))
      : [];

    const updateDoc = {
      assignedTo,
      tasks: formattedTasks,
    };

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
