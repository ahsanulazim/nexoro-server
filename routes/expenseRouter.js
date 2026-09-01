import { Router } from "express";
import {
  getAllExpenses,
  addExpense,
} from "../controllers/expenseController.js";
import { getExpense } from "../controllers/expenseController.js";
import { updateExpense } from "../controllers/expenseController.js";
import { deleteExpense } from "../controllers/expenseController.js";

const expenseRouter = Router();

expenseRouter.post("/add-expense", addExpense);
expenseRouter.get("/get-expenses", getAllExpenses);
expenseRouter.get("/get-expense", getExpense);
expenseRouter.put("/update-expense", updateExpense);
expenseRouter.delete("/delete-expense", deleteExpense);

export default expenseRouter;
