import { ObjectId } from "mongodb";
import admin from "../admin/firebase.config.js";
import client from "../config/db.js";

const orderCollection = client.db("nexoro").collection("Orders");
const orderCounterCollection = client.db("nexoro").collection("Counters");
const serviceCollection = client.db("nexoro").collection("Services");

// Helper: Generate unique orderId using counters collection
async function getNextOrderId() {
    const counter = await orderCounterCollection.findOneAndUpdate(
        { _id: "orderCounter" },
        { $inc: { sequenceValue: 1 } },
        { returnDocument: "after", upsert: true }
    );
    const seq = counter.sequenceValue;
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `ORD-${datePart}-${seq}`;
}



//create order
export const createOrder = async (req, res) => {
    const { uid, slug, planId } = req.query;
    try {
        const orderId = await getNextOrderId();

        const order = await orderCollection.insertOne({ uid, orderId, service: slug, planId, status: "Pending", createdAt: new Date() });
        res.status(200).send({ success: true, orderId: order.insertedId });
    } catch (error) {
        console.error("Order error:", error)
        return res.status(500).send({ success: false, message: "Failed to create order" })
    }
}

//get all orders
export const getAllOrders = async (req, res) => {
    try {
        const orders = await orderCollection.find().sort({ createdAt: -1 }).toArray();
        const enrichedOrders = await Promise.all(
            orders.map(async (order) => {
                // Firebase থেকে user info
                let userName = null;
                try {
                    const userRecord = await admin.auth().getUser(order.uid);
                    userName = userRecord.displayName;
                } catch (err) {
                    console.error("Firebase user fetch error:", err);
                }
                let serviceTitle = order.service;
                let planName = order.planId;
                let planPrice = null;

                // Service info
                const service = await serviceCollection.findOne({ slug: order.service });
                if (service) {
                    serviceTitle = service.title;
                    const plan = service.plans.find(p => p.id.toString() === order.planId);
                    planName = plan.planName;
                    planPrice = plan.price;
                }

                return {
                    orderId: order._id.toString(),
                    orderUid: order.orderId,
                    userName,
                    serviceTitle,
                    planName,
                    planPrice,
                    status: order.status || "Pending",
                    createdAt: order.createdAt
                };
            })
        );
        res.status(200).json({ success: true, orders: enrichedOrders });
    } catch (error) {
        console.error("Get orders error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch orders" });
    }
}

//get order by id
export const getOrder = async (req, res) => {
    const { orderId } = req.params;

    try {
        const order = await orderCollection.findOne({ _id: new ObjectId(orderId) });
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        const userRecord = await admin.auth().getUser(order.uid);
        const user = { name: userRecord.displayName, email: userRecord.email };
        const service = await serviceCollection.findOne({ slug: order.service });
        const plan = service ? service.plans.find(p => p.id.toString() === order.planId) : null;
        res.status(200).json({ success: true, order: { ...order, user, service, plan } });
    } catch (error) {
        console.error("Get order error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch order" });
    }
}