import client from "../config/db.js";

const serviceCollection = client.db("nexoro").collection("Services");
await serviceCollection.createIndex({ slug: 1 }, { unique: true });

//create new client
export const createService = async (req, res) => {
    const { title, slug, bdtPrice, usdPrice, shortDes, longDes } = req.body;
    const icon = req.file ? req.file.path : null;
    const added = new Date();
    try {
        await serviceCollection.insertOne({ title, slug, bdtPrice, usdPrice, shortDes, longDes, icon, added });
        res.status(200).json({ success: true });
    } catch (error) {
        if (error.code === 11000) {
            return res
                .status(400)
                .send({ success: false, message: "Service already exists" });
        }
        console.error("Create service error:", error);
        res
            .status(500)
            .send({ success: false, message: "Failed to create service" });
    }
};