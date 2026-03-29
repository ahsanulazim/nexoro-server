import client from "../config/db.js";

const subServicesCollection = client.db("nexoro").collection("SubServices");

export const createSubService = async (req, res) => {
  const { subService, slug, description } = req.body;
  const added = new Date();
  try {
    await subServicesCollection.insertOne({
      subService,
      slug,
      description,
      added,
    });
    res.status(200).json({ success: true });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .send({ success: false, message: "SubService already existing" });
    }
    res
      .status(500)
      .send({ success: false, message: "Failed to Create SubService" });
  }
};

//get all sub services
export const getSubServices = async (req, res) => {
  const subServices = await subServicesCollection.find().toArray();
  res.send(subServices);
};
