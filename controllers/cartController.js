import { ObjectId } from "mongodb";
import client from "../config/db.js";

const serviceCollection = client.db("nexoro").collection("Services");

// Add service to cart
export const addToCart = async (req, res) => {
    const { slug, id } = req.params;
    try {
        const service = await serviceCollection.findOne({ slug });
        if (!service) {
            return res.status(404).send({ success: false, message: "Service not found" });
        }
        const planId = new ObjectId(id);
        const plan = service.plans.find((plan) => plan.id.equals(planId));
        if (!plan) {
            return res.status(404).send({ success: false, message: "Plan not found" });
        }
        return res.status(200).send({ success: true, service: { slug: service.slug, title: service.title }, plan });
    } catch (error) {
        console.error("Add to cart error:", error);
        return res.status(500).send({ success: false, message: "Failed to add to cart" });
    }
};