import client from "../config/db.js";

const userCollection = client.db("nexoro").collection("Users");

export const verifyAdmin = async (req, res, next) => {
  const userEmail = req.user?.email;
  const user = await userCollection.findOne({ email: userEmail });

  if (user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admins only" });
  }

  next();
};
