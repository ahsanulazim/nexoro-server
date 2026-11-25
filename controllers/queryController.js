import { ObjectId } from "mongodb";
import client from "../config/db.js";

const queryCollection = client.db("nexoro").collection("ContactQueries");
const msgCollection = client.db("nexoro").collection("Messages");

// Ensure index exists for performant queries
(async () => {
  try {
    await queryCollection.createIndex({ createdAt: -1 });
    await queryCollection.createIndex({ status: 1 });
    await queryCollection.createIndex({ email: 1 });
  } catch (err) {
    console.error("Index creation error on ContactQueries:", err);
  }
})();

/**
 * Public: Create a new contact query from the website contact form
 */
export const createQuery = async (req, res) => {
  const { name, company, phone, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({
      success: false,
      message: "Name, email, and message are required fields.",
    });
  }

  const now = new Date();
  const queryDoc = {
    name: name.trim(),
    company: company ? company.trim() : "",
    phone: phone ? phone.trim() : "",
    email: email.trim().toLowerCase(),
    message: message.trim(),
    status: "unread", // "unread" | "read" | "contacted" | "resolved"
    isStarred: false,
    read: false,
    notes: [],
    source: "website_contact_form",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await queryCollection.insertOne(queryDoc);

    // Also mirror to legacy Messages collection for safety and backward compatibility
    await msgCollection.insertOne({
      ...queryDoc,
      _id: result.insertedId,
      added: now,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: "Query submitted successfully.",
      queryId: result.insertedId,
    });
  } catch (error) {
    console.error("Error creating contact query:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while saving query.",
    });
  }
};

/**
 * Admin & Member: Get all contact queries with search, filter, sorting, and pagination
 */
export const getAllQueries = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const { search, status, sortBy } = req.query;

    const filter = {};

    // Filter by status or starred
    if (status && status !== "all") {
      if (status === "starred") {
        filter.isStarred = true;
      } else if (["unread", "read", "contacted", "resolved"].includes(status)) {
        filter.status = status;
      }
    }

    // Search by name, email, company, phone, message
    if (search && search.trim() !== "") {
      const searchRegex = new RegExp(search.trim(), "i");
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { company: searchRegex },
        { phone: searchRegex },
        { message: searchRegex },
      ];
    }

    // Sorting
    const sort = {};
    if (sortBy === "oldest") {
      sort.createdAt = 1;
    } else {
      sort.createdAt = -1; // default newest
    }

    const [queries, totalFiltered, counts] = await Promise.all([
      queryCollection.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
      queryCollection.countDocuments(filter),
      Promise.all([
        queryCollection.countDocuments({}),
        queryCollection.countDocuments({ status: "unread" }),
        queryCollection.countDocuments({ status: "read" }),
        queryCollection.countDocuments({ status: "contacted" }),
        queryCollection.countDocuments({ status: "resolved" }),
        queryCollection.countDocuments({ isStarred: true }),
      ]).then(([all, unread, read, contacted, resolved, starred]) => ({
        all,
        unread,
        read,
        contacted,
        resolved,
        starred,
      })),
    ]);

    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    return res.status(200).json({
      success: true,
      data: queries,
      pagination: {
        page,
        limit,
        total: totalFiltered,
        totalPages,
        hasMore: page < totalPages,
      },
      counts,
    });
  } catch (error) {
    console.error("Error fetching contact queries:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch queries.",
    });
  }
};

/**
 * Admin & Member: Get single query by ID
 */
export const getQueryById = async (req, res) => {
  const { id } = req.params;

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid query ID." });
    }

    const query = await queryCollection.findOne({ _id: new ObjectId(id) });
    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    return res.status(200).json({ success: true, query });
  } catch (error) {
    console.error("Error fetching single query:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

/**
 * Admin & Member: Update status of a query (unread, read, contacted, resolved)
 */
export const updateQueryStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["unread", "read", "contacted", "resolved"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
    });
  }

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid query ID." });
    }

    const isRead = status !== "unread";
    const updateRes = await queryCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          read: isRead,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!updateRes) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    return res.status(200).json({
      success: true,
      message: `Status updated to ${status}.`,
      query: updateRes,
    });
  } catch (error) {
    console.error("Error updating query status:", error);
    return res.status(500).json({ success: false, message: "Failed to update query status." });
  }
};

/**
 * Admin & Member: Toggle starred/favorite status
 */
export const toggleStarQuery = async (req, res) => {
  const { id } = req.params;

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid query ID." });
    }

    const query = await queryCollection.findOne({ _id: new ObjectId(id) });
    if (!query) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    const nextStar = !query.isStarred;
    await queryCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isStarred: nextStar, updatedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      isStarred: nextStar,
      message: nextStar ? "Starred successfully." : "Unstarred successfully.",
    });
  } catch (error) {
    console.error("Error toggling star query:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle star." });
  }
};

/**
 * Admin & Member: Add an internal note to a query
 */
export const addQueryNote = async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;

  if (!text || text.trim() === "") {
    return res.status(400).json({ success: false, message: "Note text cannot be empty." });
  }

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid query ID." });
    }

    const authorName =
      req.mongoUser?.name ||
      req.user?.name ||
      req.user?.email?.split("@")[0] ||
      "Team Member";

    const note = {
      id: new ObjectId().toString(),
      text: text.trim(),
      author: authorName,
      authorEmail: req.user?.email || "",
      createdAt: new Date(),
    };

    const updateRes = await queryCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $push: { notes: note },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: "after" }
    );

    if (!updateRes) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    return res.status(201).json({
      success: true,
      message: "Note added successfully.",
      note,
      notes: updateRes.notes || [],
    });
  } catch (error) {
    console.error("Error adding note to query:", error);
    return res.status(500).json({ success: false, message: "Failed to add note." });
  }
};

/**
 * Admin & Member: Delete an internal note
 */
export const deleteQueryNote = async (req, res) => {
  const { id, noteId } = req.params;

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid query ID." });
    }

    const updateRes = await queryCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $pull: { notes: { id: noteId } },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: "after" }
    );

    if (!updateRes) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    return res.status(200).json({
      success: true,
      message: "Note deleted successfully.",
      notes: updateRes.notes || [],
    });
  } catch (error) {
    console.error("Error deleting note from query:", error);
    return res.status(500).json({ success: false, message: "Failed to delete note." });
  }
};

/**
 * Admin & Member: Delete query
 */
export const deleteQuery = async (req, res) => {
  const { id } = req.params;

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid query ID." });
    }

    const result = await queryCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Query not found." });
    }

    // Also clean up from Messages if exists
    await msgCollection.deleteOne({ _id: new ObjectId(id) }).catch(() => {});

    return res.status(200).json({ success: true, message: "Query deleted successfully." });
  } catch (error) {
    console.error("Error deleting query:", error);
    return res.status(500).json({ success: false, message: "Failed to delete query." });
  }
};

/**
 * Admin & Member: Batch operations (mark read, mark resolved, delete)
 */
export const batchUpdateQueries = async (req, res) => {
  const { ids, action } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: "No query IDs provided." });
  }

  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (objectIds.length === 0) {
    return res.status(400).json({ success: false, message: "No valid query IDs provided." });
  }

  try {
    if (action === "mark_read") {
      await queryCollection.updateMany(
        { _id: { $in: objectIds } },
        { $set: { status: "read", read: true, updatedAt: new Date() } }
      );
      return res.status(200).json({ success: true, message: "Selected queries marked as read." });
    }

    if (action === "mark_resolved") {
      await queryCollection.updateMany(
        { _id: { $in: objectIds } },
        { $set: { status: "resolved", read: true, updatedAt: new Date() } }
      );
      return res.status(200).json({ success: true, message: "Selected queries marked as resolved." });
    }

    if (action === "delete") {
      await queryCollection.deleteMany({ _id: { $in: objectIds } });
      await msgCollection.deleteMany({ _id: { $in: objectIds } }).catch(() => {});
      return res.status(200).json({ success: true, message: "Selected queries deleted." });
    }

    return res.status(400).json({ success: false, message: "Invalid action." });
  } catch (error) {
    console.error("Error performing batch update:", error);
    return res.status(500).json({ success: false, message: "Failed to execute batch operation." });
  }
};
