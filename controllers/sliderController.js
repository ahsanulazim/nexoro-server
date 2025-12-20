import client from "../config/db.js";

const sliderController = client.db("nexoro").collection("Sliders");

export const createSlider = async (req, res) => {
    try {
        await sliderController.insertOne(req.body);
        res.status(200).send({ success: true });
    } catch (error) {
        console.error("Create slider error:", error);
        res
            .status(500)
            .send({ success: false, message: "Failed to create slider" });
    }
};

export const getAllSliders = async (req, res) => {
    const sliders = await sliderController.find().toArray();
    res.send(sliders);
};
