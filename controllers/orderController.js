import { ObjectId } from "mongodb";
import admin from "../admin/firebase.config.js";
import client from "../config/db.js";

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
  const { clientId, slug, planId, discount, payment, paymentMethod, amount } =
    req.body;

  try {
    const orderId = await getNextOrderId();
    const serviceData = await serviceCollection.findOne({ slug });
    const planData = serviceData?.plans.find(
      (plan) => plan.id.toString() === planId,
    );

    const order = await orderCollection.insertOne({
      clientId,
      orderId,
      service: slug,
      planId,
      price: Number(planData?.price),
      discount,
      status: "Pending",
      createdBy: "Admin",
      assignedTo: null,
      amount: payment === "Success" ? Number(planData?.price) : amount,
      payment,
      paymentMethod,
      createdAt: new Date(),
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
      payment: req.paymentData.Status || "Pending",
      paymentMethod: req.paymentData.FinancialEntity,
      amount: Number(plan?.price),
      epsData: req.paymentData || null,
      createdAt: new Date(),
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
          "Unknown User";
        let serviceTitle = order.service;
        let planName = null;
        let planPrice = null;

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
          planPrice = plan?.price || null;
        }

        //assigned member
        let member = null;
        if (order.assignedTo) {
          member = await teamCollection.findOne({
            _id: new ObjectId(order.assignedTo),
          });
        }

        return {
          orderId: order._id.toString(),
          orderUid: order.orderId,
          userName: userName || order.epsData.customerName || order.clientName,
          serviceTitle,
          planName,
          price: planPrice,
          amount: order.amount,
          dueAmount: planPrice - order.discount - order.amount,
          assignedTo: order.assignedTo,
          assignedMember: member?.memberName || null,
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
    } else {
      const client = await clientCollection.findOne({
        _id: new ObjectId(order.clientId),
      });
      user = { name: client.name, email: client.email };
    }
    const service = await serviceCollection.findOne({ slug: order.service });
    const plan = service
      ? service.plans.find((p) => p.id.toString() === order.planId)
      : null;

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
    const result = await orderCollection.updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          uid,
          clientId,
          service: slug,
          planId,
          discount,
          status,
          amount,
          payment,
          paymentMethod,
        },
      },
    );
    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found or status unchanged",
      });
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
  const { assignedTo } = req.body;
  console.log(id, assignedTo);

  try {
    const result = await orderCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { assignedTo } },
    );
    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found or status unchanged",
      });
    }
    res
      .status(200)
      .json({ success: true, message: "Order assigned to member" });
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
