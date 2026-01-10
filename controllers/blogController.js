import { ObjectId } from "mongodb";
import client from "../config/db.js";

const blogCollection = client.db("nexoro").collection("Blogs");
await blogCollection.createIndex({ slug: 1 }, { unique: true });

// Create a new blog post
export const createBlog = async (req, res) => {
    const { title, slug, content, author, category, description, visibility } = req.body;
    const visible = visibility === "true";
    const categoryId = new ObjectId(category)
    const { filename, path } = req.file;
    const added = new Date();
    try {
        await blogCollection.insertOne({
            title,
            slug,
            content,
            author,
            categoryId,
            description,
            visibility: visible,
            image: path,
            public_id: filename,
            added,
        });
        res.status(200).json({ success: true });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).send({ success: false, message: "Blog post already exists" });
        } res.status(500).send({ success: false, message: "Failed to create blog post" });
    }
};

export const getAllBlogs = async (req, res) => {
    const blogs = await blogCollection.aggregate([
        {
            $lookup: {
                from: "Categories",
                localField: "categoryId",
                foreignField: "_id",
                as: "category"
            }
        },
        {
            $unwind: "$category"
        }
    ]).toArray();
    res.send(blogs)
}