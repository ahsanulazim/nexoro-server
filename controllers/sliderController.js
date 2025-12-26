import { ObjectId } from "mongodb";
import client from "../config/db.js";

const clientCollection = client.db("nexoro").collection("Clients");

// Bulk update endpoint
export const updateSliderClients = async (req, res) => {
  try {
    const { ids, slider } = req.body;

    // Convert string ids to ObjectId
    const objectIds = ids.map((id) => new ObjectId(id));

    await clientCollection.updateMany(
      { _id: { $in: objectIds } },
      { $set: { slider } }
    );

    await clientCollection.updateMany(
      { _id: { $nin: objectIds } },
      { $set: { slider: false } }
    );


    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error updating slider clients" });
  }
};

// update a single client slider
export const deleteClientSlider = async (req, res) => {
  try {
    const { id } = req.params;
    await clientCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { slider: false } }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error updating slider status" });
  }

}