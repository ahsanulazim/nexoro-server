import client from "../config/db.js";

const userCollection = client.db("nexoro").collection("Users");

export const verifyAdminOrMember = async (req, res, next) => {
  const userEmail = req.user?.email;
  const user = await userCollection.findOne({ email: userEmail });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (user.role !== "admin" && user.role !== "member") {
    return res.status(403).json({ error: "Access denied" });
  }

  next();
};
