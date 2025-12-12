import { ObjectId } from "mongodb";
import client from "../config/db.js";

const reviewCollection = client.db("nexoro").collection("Reviews");

//create new client
export const createReview = async (req, res) => {
    const { clientName, rating, review } = req.body;

    console.log(req.body);


    const added = new Date();
    try {
        await reviewCollection.insertOne({ clientName, rating, review, added });
        res.status(200).send({ success: true });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).send({ success: false, message: "Review already exists" });
        }
        console.error("Create Review error:", error);
        res.status(500).send({ success: false, message: "Failed to create review" });
    }
};

// Get all Reviews
export const getAllReviews = async (req, res) => {
    const reviews = await reviewCollection.find().toArray();
    res.send(reviews);
};

// Delete Reviews
export const deleteReviews = async (req, res) => {
    const id = req.params.id;
    try {
        const result = await reviewCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount > 0) {
            return res.send({
                success: true,
                message: "Review deleted successfully",
            });
        } else {
            return res.send({
                success: false,
                message: "Review not found in MongoDB",
            });
        }
    } catch (error) {
        console.error("Delete error:", error);
        return res
            .status(500)
            .send({ success: false, message: "Failed to delete Review" });
    }
};

// update review
export const updateReview = async (req, res) => {
    try {
        const id = req.params.id;

        const { clientName, rating, review } = req.body;
        const existingReview = await reviewCollection.findOne({ _id: new ObjectId(id) });

        if (!existingReview) {
            return res.status(404).json({ message: "Review not found" });
        }
        const updatedReview = { clientName, rating, review, added: new Date() };

        await reviewCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedReview });
        res.status(200).json({ success: true, message: "Review updated successfully" });
    } catch (error) {
        console.error("Update review error:", error);
        res.status(500).json({ success: false, message: "Failed to update review" });
    }
};