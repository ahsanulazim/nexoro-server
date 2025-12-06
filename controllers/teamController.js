import client from "../config/db.js";

const teamCollection = client.db("nexoro").collection("Team");

//create new client
export const addMember = async (req, res) => {
    const { memberName, role, email, website, github, behance, linkedin } = req.body;
    const { filename, path } = req.file;
    const joined = new Date();
    try {
        await teamCollection.insertOne({ memberName, role, email, website, github, behance, linkedin, profilePic: path, public_id: filename, joined });
        res.status(200).send({ success: true });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).send({ success: false, message: "Member already exists" });
        }
        res.status(500).send({ success: false, message: "Failed to add Member" });
    }
};

// Get all Members
export const getAllMembers = async (req, res) => {
    const team = await teamCollection.find().toArray();
    res.send(team);
};