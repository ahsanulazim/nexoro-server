import client from "../config/db.js";
import admin from "../admin/firebase.config.js";

const userCollection = client.db("nexoro").collection("Users");
await userCollection.createIndex({ email: 1 }, { unique: true });

// Create new user
export const createUser = async (req, res) => {
  const { userName, email } = req.body;
  const uid = req.user?.uid;
  const emailVerified = req.user?.email_verified || false;
  // Check if sign-in provider is Google
  const firebaseProvider = req.user?.firebase?.sign_in_provider;
  const google = firebaseProvider === "google.com";
  const role = "customer";
  const createdAt = new Date();
  const newUser = {
    userName,
    email,
    google,
    uid,
    role,
    createdAt,
  };
  try {
    const user = await userCollection.findOneAndUpdate(
      { uid },
      {
        $setOnInsert: newUser,
        $set: {
          emailVerified,
          lastLoginAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    return res.status(200).send({
      success: true,
      message: "User synced successfully",
      user,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .send({ success: false, message: "User already exists" });
    }
    console.error("Create user error:", error);
    res.status(500).send({ success: false, message: "Failed to create user" });
  }
};

// Get single user
export const getUser = async (req, res) => {
  const decodedToken = req.user;

  if (!decodedToken || !decodedToken.email) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const email = decodedToken.email;
  const uid = decodedToken.uid;
  const emailVerified = decodedToken.email_verified || false;
  const firebaseProvider = decodedToken.firebase?.sign_in_provider;
  const google = firebaseProvider === "google.com";

  try {
    let user = await userCollection.findOne({ email });

    if (!user) {
      // Auto-create user if they exist in Firebase but not in MongoDB yet
      const role = "customer";
      const createdAt = new Date();
      const newUser = {
        userName: decodedToken.name || email.split("@")[0],
        email,
        google,
        uid,
        role,
        createdAt,
        emailVerified,
        lastLoginAt: new Date(),
      };
      await userCollection.insertOne(newUser);
      user = newUser;
    } else {
      // Sync UID, emailVerified, and lastLoginAt to MongoDB
      user = await userCollection.findOneAndUpdate(
        { email },
        {
          $set: {
            uid,
            emailVerified,
            lastLoginAt: new Date(),
          },
        },
        { returnDocument: "after" }
      );
    }

    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Get user error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

// Get all customers
export const getAllUsers = async (req, res) => {
  try {
    const customer = await userCollection.find({ role: "customer" }).toArray();
    res.status(200).json(customer);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch customers", error });
  }
};

//Get all members
export const getAllMembers = async (req, res) => {
  try {
    const members = await userCollection.find({ role: "member" }).toArray();
    res.status(200).json(members);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch members", error });
  }
};

// Promote User
export const promoteUser = async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email query param required" });
  }

  try {
    const user = await userCollection.updateOne(
      { email },
      { $set: { role: "member" } },
    );
    if (user.modifiedCount > 0) {
      res
        .status(200)
        .send({ success: true, message: "User promoted to member" });
    } else {
      res.status(404).send({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
};
// demote Member
export const demoteMember = async (req, res) => {
  const email = req.query.email;
  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email query param required" });
  }

  try {
    const user = await userCollection.updateOne(
      { email },
      { $set: { role: "customer" } },
    );
    if (user.modifiedCount > 0) {
      res
        .status(200)
        .send({ success: true, message: "Member demoted to customer" });
    } else {
      res.status(404).send({ success: false, message: "Member not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
};

// Update user
export const updateUser = async (req, res) => {
  const decodedToken = req.user;

  if (!decodedToken || !decodedToken.uid) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const uid = decodedToken.uid;
  const updatedData = req.body;

  try {
    const result = await userCollection.updateOne(
      { uid },
      { $set: updatedData },
    );
    if (result.modifiedCount > 0) {
      res.status(200).send({ success: true, message: "User updated" });
    } else {
      res.status(404).send({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ success: false, message: "Internal server error" });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  const email = req.query.email;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(userRecord.uid);
    const result = await userCollection.deleteOne({ email });
    if (result.deletedCount > 0) {
      return res.send({ success: true, message: "User deleted successfully" });
    } else {
      return res.send({ success: false, message: "User not found in MongoDB" });
    }
  } catch (error) {
    console.error("Delete error:", error);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete user" });
  }
};
