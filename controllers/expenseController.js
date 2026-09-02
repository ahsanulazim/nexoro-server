import { ObjectId } from "mongodb";
import client from "../config/db.js";
import { broadcastDashboardStats } from "../utils/dashboardHelper.js";

const expenseCollection = client.db("nexoro").collection("expenses");

export const addExpense = async (req, res) => {
  const {
    title,
    invoice,
    invoiceDate,
    amount,
    paymentStatus,
    paymentMethod,
    paidTo,
    frequency,
    note,
  } = req.body;

  if (!title || !amount) {
    return res.status(400).json({ message: "Title and amount are required" });
  }

  const expense = {
    title,
    invoice,
    invoiceDate,
    amount,
    paymentStatus,
    paymentMethod,
    paidTo,
    frequency,
    note,
    createdAt: new Date(),
  };

  try {
    const result = await expenseCollection.insertOne(expense);

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to add expense", error });
  }
};

export const getAllExpenses = async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const searchTerm = req.query.search?.trim() || "";
  const skip = (page - 1) * limit;

  let query = {};

  if (searchTerm) {
    query = {
      $or: [
        { title: { $regex: searchTerm, $options: "i" } },
        { paidTo: { $regex: searchTerm, $options: "i" } },
        { invoice: { $regex: searchTerm, $options: "i" } },
      ],
    };
  }
  const count = await expenseCollection.countDocuments(query);

  try {
    const expenses = await expenseCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    if (!expenses) {
      return res.status(404).json({ message: "No expenses found" });
    }

    const totalPages = Math.ceil(count / limit);
    res.status(200).json({ expenses, totalPages });
  } catch (error) {
    res.status(500).json({ message: "Failed to get expenses", error });
  }
};

export const getExpense = async (req, res) => {
  const { id } = req.query;
  try {
    const expense = await expenseCollection.findOne({ _id: new ObjectId(id) });
    if (!expense) {
      return res.status(404).json({ message: "No expense found" });
    }
    res.status(200).json(expense);
  } catch (error) {
    res.status(500).json({ message: "Failed to get expense", error });
  }
};

export const updateExpense = async (req, res) => {
  const { id } = req.query;
  const updatedData = req.body;
  try {
    const result = await expenseCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData },
    );
    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "No expense found" });
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to update expense", error });
  }
};

export const deleteExpense = async (req, res) => {
  const { id } = req.query;
  try {
    const result = await expenseCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "No expense found" });
    }

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err)
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: "Failed to delete expense", error });
  }
};
