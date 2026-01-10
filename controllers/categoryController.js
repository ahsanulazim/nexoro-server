import client from "../config/db.js";

const categoryCollection = client.db("nexoro").collection("Categories");

export const createCategory = async (req, res) => {
    const { category, slug, description } = req.body;
    const added = new Date();
    try {
        await categoryCollection.insertOne({ category, slug, description, added })
        res.status(200).json({ success: true })
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).send({ success: false, message: "Category already existing" });
        } res.status(500).send({ success: false, message: "Failed to Create Category" })
    }
}

//get all categories
export const getCategories = async (req, res) => {
    const categories = await categoryCollection.find().toArray();
    res.send(categories);
}