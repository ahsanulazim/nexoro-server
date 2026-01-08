import { ObjectId } from "mongodb";
import client from "../config/db.js";

const serviceCollection = client.db("nexoro").collection("Services");

export const createPlan = async (req, res) => {
  const { planName, price, benefits } = req.body;
  const added = new Date();
  try {
    const slug = req.params.slug;
    const existingService = await serviceCollection.findOne({ slug });
    if (!existingService) {
      return res.status(404).json({ message: "Service not found" });
    }
    const plan = { id: new ObjectId(), planName, price, benefits, added };
    await serviceCollection.updateOne({ slug }, { $push: { plans: plan } });
    res.status(201).json({ message: "Plan added successfully", plan: plan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const editPlan = async (req, res) => {
  const { planName, price, benefits } = req.body;
  const { slug, planId } = req.params;
  try {
    const result = await serviceCollection.updateOne(
      { slug, "plans.id": new ObjectId(planId) },
      {
        $set: {
          "plans.$.planName": planName,
          "plans.$.price": price,
          "plans.$.benefits": benefits,
          "plans.$.added": new Date(),
        },
      }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Service or Plan not found" });
    }
    res.status(200).json({ message: "Plan updated successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getPlans = async (req, res) => {
  try {
    const slug = req.params.selectedSlug;
    const service = await serviceCollection.findOne({ slug });
    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }
    res.status(200).json(service.plans || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};