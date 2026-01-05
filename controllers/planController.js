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
    const plan = { planName, price, benefits, added };
    await serviceCollection.updateOne({ slug }, { $push: { plans: plan } });
    res.status(201).json({ message: "Plan added successfully", plan: plan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
