import { ObjectId } from "mongodb";
import client from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

const teamCollection = client.db("nexoro").collection("Team");

//create new client
export const addMember = async (req, res) => {
    const { memberName, role, gender, email, website, github, behance, linkedin } = req.body;
    const { filename, path } = req.file;
    const joined = new Date();
    try {
        await teamCollection.insertOne({ memberName, role, gender, email, website, github, behance, linkedin, profilePic: path, public_id: filename, joined });
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

// Delete team
export const deleteMember = async (req, res) => {
    const id = req.params.id;
    try {
        const result = await teamCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount > 0) {
            return res.send({ success: true, message: "Member deleted successfully", });
        } else {
            return res.send({ success: false, message: "Member not found in MongoDB", });
        }
    } catch (error) {
        console.error("Delete error:", error);
        return res.status(500).send({ success: false, message: "Failed to delete Member" });
    }
};

// update Member
export const updateMember = async (req, res) => {
    try {
        const id = req.params.id;
        const { memberName, role, gender, email, website, github, behance, linkedin } = req.body;
        const existingMember = await teamCollection.findOne({ _id: new ObjectId(id) });

        if (!existingMember) {
            return res.status(404).json({ message: "Member not found" });
        }
        const updatedMember = {
            memberName, role, gender, email, website, github, behance, linkedin, joined: new Date(),
        };

        if (req.file) {
            if (existingMember.public_id) {
                cloudinary.uploader.destroy(existingMember.public_id);
            }
            updatedMember.profilePic = req.file.path;
            updatedMember.public_id = req.file.filename;
        } else {
            updatedMember.profilePic = existingMember.profilePic;
            updatedMember.public_id = existingMember.public_id;
        }

        await teamCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedMember });
        res.status(200).json({ success: true, message: "Member updated successfully" });
    } catch (error) {
        console.error("Update member error:", error);
        res.status(500).json({ success: false, message: "Failed to update member" });
    }
};