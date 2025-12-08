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