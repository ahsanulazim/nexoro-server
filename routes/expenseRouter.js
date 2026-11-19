import { Router } from "express";
import {
  getAllExpenses,
  addExpense,
  getExpense,
  updateExpense,
  deleteExpense,
} from "../controllers/expenseController.js";
import { verifyPermission } from "../middleware/verifyPermission.js";

const expenseRouter = Router();

// All expense routes require 'expenses' permission (Admin or Member with 'expenses' permission)
expenseRouter.use(verifyPermission("expenses"));

expenseRouter.post("/add-expense", addExpense);
expenseRouter.get("/get-expenses", getAllExpenses);
expenseRouter.get("/get-expense", getExpense);
expenseRouter.put("/update-expense", updateExpense);
expenseRouter.delete("/delete-expense", deleteExpense);

export default expenseRouter;
