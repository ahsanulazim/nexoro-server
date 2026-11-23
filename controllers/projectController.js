import { ObjectId } from "mongodb";
import client from "../config/db.js";
import admin from "../admin/firebase.config.js";
import { createAndSendNotification } from "../utils/notificationHelper.js";
import { broadcastDashboardStats } from "../utils/dashboardHelper.js";
import { convertToBDT } from "../utils/currencyHelper.js";
import { syncOrderCompletionPoints } from "./pointsController.js";

const orderCollection = client.db("nexoro").collection("Orders");
const orderCounterCollection = client.db("nexoro").collection("Counters");
const serviceCollection = client.db("nexoro").collection("Services");
const teamCollection = client.db("nexoro").collection("Team");
const userCollection = client.db("nexoro").collection("Users");

// Helper: Generate unique projectId (PRJ-1, PRJ-2, ...)
const getNextProjectId = async () => {
  const counter = await orderCounterCollection.findOneAndUpdate(
    { _id: "projectCounter" },
    { $inc: { sequenceValue: 1 } },
    { returnDocument: "after", upsert: true },
  );
  const seq = counter?.sequenceValue ?? counter?.value?.sequenceValue ?? 1;
  return `PRJ-${seq}`;
};

// Create a brand new standalone project (Admin Only)
export const createProject = async (req, res) => {
  try {
    // Verify caller is Admin
    let caller = null;
    if (req.user?.email) {
      caller = await userCollection.findOne({
        email: { $regex: new RegExp(`^${req.user.email.trim()}$`, "i") },
      });
    }

    if (caller?.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Only administrators can create standalone projects",
      });
    }

    const {
      assignedTo,
      assignedMembers,
      clientId,
      slug = "custom",
      planId,
      serviceName,
      planName,
      servicePrice,
      discount,
      payment = "Pending",
      paymentMethod = "",
      amount,
      deadline,
      rewardPoints,
      tasks,
    } = req.body;

    const hasAssignedMembers =
      Array.isArray(assignedMembers) && assignedMembers.length > 0;
    if (!hasAssignedMembers && (!assignedTo || !String(assignedTo).trim())) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one member to assign the project to",
      });
    }

    const formattedTasks = Array.isArray(tasks)
      ? tasks
          .filter((t) => t?.task && String(t.task).trim() !== "")
          .map((t) => ({
            task: String(t.task).trim(),
            isCompleted: Boolean(t.isCompleted),
          }))
      : [];

    if (formattedTasks.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please add at least one task for this project",
      });
    }

    let price = 0;
    let serviceTitle = serviceName || slug || "Custom Project";
    let resolvedPlanName = planName || "Custom Plan";
    let discountNum = 0;
    let amountNum = 0;

    if (slug === "custom" || !slug) {
      if (!serviceName || !String(serviceName).trim()) {
        return res.status(400).json({
          success: false,
          message: "Project / Service title is required",
        });
      }
      price = Math.max(0, Number(servicePrice) || 0);
      serviceTitle = String(serviceName).trim();
      resolvedPlanName = planName && String(planName).trim() ? String(planName).trim() : "Custom Plan";
      discountNum = Math.max(0, Number(discount) || 0);
      amountNum =
        payment === "Success"
          ? Math.max(0, price - discountNum)
          : Math.max(0, Number(amount) || 0);
    } else {
      const serviceData = await serviceCollection.findOne({ slug });
      const planData = serviceData?.plans?.find(
        (plan) => plan.id?.toString() === planId?.toString(),
      );
      const planPriceUSD = Number(planData?.price) || 0;
      price = await convertToBDT(planPriceUSD);
      serviceTitle = serviceData?.title || serviceName || slug;
      resolvedPlanName = planData?.planName || planName || "Standard Plan";

      discountNum = Math.max(0, Number(discount) || 0);
      amountNum =
        payment === "Success"
          ? Math.max(0, price - discountNum)
          : Math.max(0, Number(amount) || 0);
    }

    const projectId = await getNextProjectId();
    const parsedRewardPoints =
      rewardPoints !== undefined && rewardPoints !== null && rewardPoints !== ""
        ? Math.max(0, Number(rewardPoints))
        : 5;

    const allCompleted =
      formattedTasks.length > 0 &&
      formattedTasks.every((t) => t.isCompleted === true);
    const initialStatus = allCompleted ? "Completed" : "Processing";

    const createdBy = caller?.name || caller?.displayName || "Admin";
    const createdById = caller?._id || null;

    // Resolve assigned member(s) details
    const formattedAssignedMembers = [];
    if (Array.isArray(assignedMembers) && assignedMembers.length > 0) {
      for (const m of assignedMembers) {
        const memberIdStr = String(m.memberId || m._id || "").trim();
        if (!memberIdStr) continue;

        let memberName = m.memberName || "";
        let memberEmail = m.memberEmail || "";
        let memberRole = m.role || "member";

        if (ObjectId.isValid(memberIdStr)) {
          const userDoc = await userCollection.findOne({ _id: new ObjectId(memberIdStr) });
          if (userDoc) {
            memberName = userDoc.name || userDoc.displayName || userDoc.email;
            memberEmail = userDoc.email || "";
            memberRole = userDoc.role || "member";
          } else {
            const teamDoc = await teamCollection.findOne({ _id: new ObjectId(memberIdStr) });
            if (teamDoc) {
              memberName = teamDoc.memberName || teamDoc.email;
              memberEmail = teamDoc.email || "";
              memberRole = teamDoc.role || "member";
            }
          }
        }

        const mRateType = m.rateType === "flat" ? "flat" : "percentage";
        const mRateValue = Math.max(0, Number(m.rateValue) || 0);
        const mAmount =
          mRateType === "percentage"
            ? Math.round(price * (mRateValue / 100))
            : mRateValue;

        formattedAssignedMembers.push({
          memberId: memberIdStr,
          memberName: memberName || "Member",
          memberEmail: memberEmail || "",
          role: memberRole,
          rateType: mRateType,
          rateValue: mRateValue,
          amount: mAmount,
          assignedAt: new Date(),
        });
      }
    } else if (assignedTo) {
      const memberIdStr = String(assignedTo).trim();
      let memberName = "";
      let memberEmail = "";
      let memberRole = "member";

      if (ObjectId.isValid(memberIdStr)) {
        const userDoc = await userCollection.findOne({ _id: new ObjectId(memberIdStr) });
        if (userDoc) {
          memberName = userDoc.name || userDoc.displayName || userDoc.email;
          memberEmail = userDoc.email || "";
          memberRole = userDoc.role || "member";
        } else {
          const teamDoc = await teamCollection.findOne({ _id: new ObjectId(memberIdStr) });
          if (teamDoc) {
            memberName = teamDoc.memberName || teamDoc.email;
            memberEmail = teamDoc.email || "";
            memberRole = teamDoc.role || "member";
          }
        }
      }

      const mRateType = req.body.rateType === "flat" ? "flat" : "percentage";
      const mRateValue = Math.max(0, Number(req.body.rateValue) || 0);
      const mAmount =
        mRateType === "percentage"
          ? Math.round(price * (mRateValue / 100))
          : mRateValue;

      formattedAssignedMembers.push({
        memberId: memberIdStr,
        memberName: memberName || "Member",
        memberEmail: memberEmail || "",
        role: memberRole,
        rateType: mRateType,
        rateValue: mRateValue,
        amount: mAmount,
        assignedAt: new Date(),
      });
    }

    const primaryAssigneeId = formattedAssignedMembers[0]?.memberId || String(assignedTo || "").trim();
    const primaryAssigneeEmail = formattedAssignedMembers[0]?.memberEmail || null;
    const primaryAssigneeName = formattedAssignedMembers.map((m) => m.memberName).join(", ");

    const newProjectDoc = {
      isStandaloneProject: true,
      orderId: projectId,
      clientId: clientId && String(clientId).trim() ? String(clientId).trim() : null,
      service: slug || "custom",
      serviceName: serviceTitle,
      planName: resolvedPlanName,
      servicePrice: price,
      planId: slug === "custom" ? null : planId || null,
      price,
      discount: discountNum,
      amount: amountNum,
      payment: payment || "Pending",
      paymentMethod: payment === "Pending" ? "" : paymentMethod || "",
      status: initialStatus,
      createdBy,
      createdByRole: "admin",
      createdById,
      assignedTo: primaryAssigneeId,
      assignedMember: primaryAssigneeName,
      ...(primaryAssigneeEmail ? { assignedMemberEmail: primaryAssigneeEmail } : {}),
      assignedMembers: formattedAssignedMembers,
      rewardPoints: parsedRewardPoints,
      tasks: formattedTasks,
      costs: [],
      totalCost: 0,
      deadline: deadline ? new Date(deadline) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insertRes = await orderCollection.insertOne(newProjectDoc);
    const createdDoc = { ...newProjectDoc, _id: insertRes.insertedId };

    // Notify all assigned members
    if (formattedAssignedMembers.length > 0) {
      for (const m of formattedAssignedMembers) {
        const rateDesc = m.rateValue
          ? ` (${m.rateType === "percentage" ? `${m.rateValue}%` : `৳${m.rateValue}`} earning)`
          : "";
        await createAndSendNotification({
          type: "project_assigned",
          title: "New Project Assigned",
          message: `You have been assigned to project #${projectId} (${serviceTitle}) by ${createdBy}${rateDesc}.`,
          link: "/dashboard/projects",
          recipientId: m.memberId,
        });
      }
    } else if (primaryAssigneeId) {
      await createAndSendNotification({
        type: "project_assigned",
        title: "New Project Assigned",
        message: `You have been assigned to project #${projectId} (${serviceTitle}) by ${createdBy}.`,
        link: "/dashboard/projects",
        recipientId: primaryAssigneeId,
      });
    }

    // If all tasks were already marked completed on creation, sync completion points
    if (initialStatus === "Completed") {
      await syncOrderCompletionPoints({
        order: createdDoc,
        newStatus: "Completed",
        previousStatus: "Processing",
      });
    }

    // Real-time broadcast for dashboard stats
    broadcastDashboardStats().catch((err) =>
      console.error("Dashboard stats broadcast error:", err),
    );

    return res.status(201).json({
      success: true,
      message: `Project #${projectId} created and assigned${assignedMemberName ? ` to ${assignedMemberName}` : ""} successfully`,
      project: createdDoc,
    });
  } catch (error) {
    console.error("Create standalone project error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create project",
      error: error.message,
    });
  }
};

export const getAllProjects = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const skip = (page - 1) * limit;
    const tab = (req.query.tab || req.query.filterTab || "all").toLowerCase();
    const search = (req.query.search || req.query.searchTerm || "").trim();

    let currentUserEmail = (req.query.userEmail || "").toLowerCase().trim();
    let currentUserId = (req.query.userId || "").trim();
    let currentUserName = (req.query.userName || "").toLowerCase().trim();

    // Optionally extract from auth token if not passed in query
    if (!currentUserEmail && req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(" ")[1];
        if (token) {
          const decoded = await admin.auth().verifyIdToken(token);
          if (decoded?.email) currentUserEmail = decoded.email.toLowerCase().trim();
          if (!currentUserId && decoded?.uid) currentUserId = decoded.uid.trim();
          if (!currentUserName && decoded?.name) currentUserName = decoded.name.toLowerCase().trim();
        }
      } catch (e) {
        // Fall back gracefully
      }
    }

    // Look up team member ID if user email/name is present
    let memberIdStr = "";
    if (currentUserEmail || currentUserName) {
      const orMemberQuery = [];
      if (currentUserEmail) {
        orMemberQuery.push({ email: { $regex: new RegExp(`^${currentUserEmail}$`, "i") } });
      }
      if (currentUserName) {
        orMemberQuery.push({ memberName: { $regex: new RegExp(`^${currentUserName}$`, "i") } });
      }
      if (orMemberQuery.length > 0) {
        const memberDoc = await teamCollection.findOne({ $or: orMemberQuery });
        if (memberDoc) {
          memberIdStr = memberDoc._id.toString();
        }
      }
    }

    const assignedMatchConditions = [];
    if (currentUserEmail) {
      assignedMatchConditions.push({
        $eq: [{ $toLower: { $ifNull: ["$assignedMemberEmail", ""] } }, currentUserEmail],
      });
      assignedMatchConditions.push({
        $in: [
          currentUserEmail,
          {
            $map: {
              input: { $ifNull: ["$assignedMembers", []] },
              as: "am",
              in: { $toLower: { $ifNull: ["$$am.memberEmail", ""] } },
            },
          },
        ],
      });
    }
    if (currentUserId) {
      assignedMatchConditions.push({
        $eq: [{ $toString: { $ifNull: ["$assignedToId", ""] } }, currentUserId],
      });
      assignedMatchConditions.push({
        $in: [
          currentUserId,
          {
            $map: {
              input: { $ifNull: ["$assignedMembers", []] },
              as: "am",
              in: { $toString: { $ifNull: ["$$am.memberId", ""] } },
            },
          },
        ],
      });
    }
    if (memberIdStr) {
      assignedMatchConditions.push({
        $eq: [{ $toString: { $ifNull: ["$assignedToId", ""] } }, memberIdStr],
      });
      assignedMatchConditions.push({
        $in: [
          memberIdStr,
          {
            $map: {
              input: { $ifNull: ["$assignedMembers", []] },
              as: "am",
              in: { $toString: { $ifNull: ["$$am.memberId", ""] } },
            },
          },
        ],
      });
    }
    if (currentUserName) {
      assignedMatchConditions.push({
        $eq: [{ $toLower: { $ifNull: ["$assignedTo", ""] } }, currentUserName],
      });
    }

    const isAssignedExpr =
      assignedMatchConditions.length > 0
        ? { $or: assignedMatchConditions }
        : false;

    // Filter conditions for active tab & search
    const filterConditions = [];

    if (tab === "active") {
      filterConditions.push({ isActive: true });
    } else if (tab === "completed") {
      filterConditions.push({ isCompleted: true });
    } else if (tab === "my") {
      filterConditions.push({ isAssignedToMe: true });
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escapedSearch, "i");
      filterConditions.push({
        $or: [
          { serviceName: { $regex: searchRegex } },
          { planName: { $regex: searchRegex } },
          { client: { $regex: searchRegex } },
          { assignedTo: { $regex: searchRegex } },
          { orderId: { $regex: searchRegex } },
        ],
      });
    }

    const matchStage =
      filterConditions.length > 0 ? { $match: { $and: filterConditions } } : null;

    const pipeline = [
      // Filter out orders where assignedTo is null, empty, or missing
      {
        $match: {
          assignedTo: { $ne: null, $exists: true, $nin: ["", null] },
        },
      },
      { $sort: { createdAt: -1 } },
      // Lookup service from Services collection by matching slug with order.service
      {
        $lookup: {
          from: "Services",
          localField: "service",
          foreignField: "slug",
          as: "serviceDoc",
        },
      },
      // Lookup team member from Team collection by matching _id with order.assignedTo
      {
        $lookup: {
          from: "Team",
          let: { assignedToId: "$assignedTo" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$assignedToId", null] },
                    { $ne: ["$$assignedToId", ""] },
                    {
                      $eq: [
                        "$_id",
                        {
                          $convert: {
                            input: "$$assignedToId",
                            to: "objectId",
                            onError: null,
                            onNull: null,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          as: "teamMember",
        },
      },
      // Lookup registered user from Users collection by matching _id with order.assignedTo
      {
        $lookup: {
          from: "Users",
          let: { assignedToId: "$assignedTo" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$assignedToId", null] },
                    { $ne: ["$$assignedToId", ""] },
                    {
                      $eq: [
                        "$_id",
                        {
                          $convert: {
                            input: "$$assignedToId",
                            to: "objectId",
                            onError: null,
                            onNull: null,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
          as: "userMember",
        },
      },
      // Lookup client name from Clients collection (if clientId exists)
      {
        $lookup: {
          from: "Clients",
          let: { clientIdVal: "$clientId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$clientIdVal", null] },
                    { $ne: ["$$clientIdVal", ""] },
                    {
                      $eq: [
                        "$_id",
                        {
                          $convert: {
                            input: "$$clientIdVal",
                            to: "objectId",
                            onError: null,
                            onNull: null,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 0,
                name: 1,
              },
            },
          ],
          as: "clientDoc",
        },
      },
      // Extract matched service, member, user, and client
      {
        $addFields: {
          matchedService: { $arrayElemAt: ["$serviceDoc", 0] },
          matchedMember: { $arrayElemAt: ["$teamMember", 0] },
          matchedUser: { $arrayElemAt: ["$userMember", 0] },
          matchedClient: { $arrayElemAt: ["$clientDoc", 0] },
        },
      },
      // Extract matched plan from matchedService.plans matching planId
      {
        $addFields: {
          matchedPlan: {
            $arrayElemAt: [
              {
                $filter: {
                  input: { $ifNull: ["$matchedService.plans", []] },
                  as: "plan",
                  cond: {
                    $eq: [
                      { $toString: "$$plan.id" },
                      { $toString: "$planId" },
                    ],
                  },
                },
              },
              0,
            ],
          },
        },
      },
      // Project the final structure
      {
        $project: {
          _id: 1,
          orderId: 1,
          client: { $ifNull: ["$matchedClient.name", null] },
          planName: {
            $cond: {
              if: { $eq: ["$service", "custom"] },
              then: { $ifNull: ["$planName", "Custom Plan"] },
              else: { $ifNull: ["$matchedPlan.planName", { $ifNull: ["$planName", null] }] },
            },
          },
          serviceName: {
            $cond: {
              if: { $eq: ["$service", "custom"] },
              then: { $ifNull: ["$serviceName", "Custom Service"] },
              else: { $ifNull: ["$matchedService.title", "$service"] },
            },
          },
          servicePrice: {
            $cond: {
              if: { $eq: ["$service", "custom"] },
              then: {
                $convert: {
                  input: { $ifNull: ["$servicePrice", "$price"] },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
              else: {
                $convert: {
                  input: {
                    $ifNull: [
                      "$matchedPlan.price",
                      { $ifNull: ["$price", 0] },
                    ],
                  },
                  to: "double",
                  onError: 0,
                  onNull: 0,
                },
              },
            },
          },
          price: 1,
          assignedTo: {
            $ifNull: [
              "$matchedUser.name",
              { $ifNull: ["$matchedMember.memberName", null] },
            ],
          },
          assignedToId: "$assignedTo",
          assignedMemberEmail: {
            $ifNull: [
              "$matchedUser.email",
              { $ifNull: ["$matchedMember.email", null] },
            ],
          },
          assignedMemberRole: {
            $ifNull: [
              "$matchedUser.role",
              { $ifNull: ["$matchedMember.role", null] },
            ],
          },
          status: 1,
          deadline: { $ifNull: ["$deadline", null] },
          amount: {
            $convert: {
              input: "$amount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          discount: {
            $convert: {
              input: "$discount",
              to: "double",
              onError: 0,
              onNull: 0,
            },
          },
          payment: 1,
          paymentMethod: 1,
          rewardPoints: { $ifNull: ["$rewardPoints", 5] },
          tasks: 1,
          assignedMembers: { $ifNull: ["$assignedMembers", []] },
          costs: { $ifNull: ["$costs", []] },
          totalCost: { $ifNull: ["$totalCost", 0] },
          createdBy: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      // Add completion, active and assigned flags
      {
        $addFields: {
          isCompleted: {
            $let: {
              vars: {
                statusLower: { $toLower: { $ifNull: ["$status", ""] } },
                tasksList: { $ifNull: ["$tasks", []] },
              },
              in: {
                $cond: {
                  if: { $eq: ["$$statusLower", "cancelled"] },
                  then: false,
                  else: {
                    $cond: {
                      if: { $eq: ["$$statusLower", "completed"] },
                      then: true,
                      else: {
                        $cond: {
                          if: {
                            $and: [
                              { $isArray: "$$tasksList" },
                              { $gt: [{ $size: "$$tasksList" }, 0] },
                              {
                                $eq: [
                                  {
                                    $size: {
                                      $filter: {
                                        input: "$$tasksList",
                                        as: "t",
                                        cond: { $eq: ["$$t.isCompleted", true] },
                                      },
                                    },
                                  },
                                  { $size: "$$tasksList" },
                                ],
                              },
                            ],
                          },
                          then: true,
                          else: false,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        $addFields: {
          isActive: {
            $cond: {
              if: { $eq: [{ $toLower: { $ifNull: ["$status", ""] } }, "cancelled"] },
              then: false,
              else: { $not: "$isCompleted" },
            },
          },
          isAssignedToMe: isAssignedExpr,
        },
      },
      // Facet for tab counts, totalFiltered count, and paginated data
      {
        $facet: {
          overallCounts: [
            {
              $group: {
                _id: null,
                totalAll: { $sum: 1 },
                totalActive: {
                  $sum: { $cond: ["$isActive", 1, 0] },
                },
                totalCompleted: {
                  $sum: { $cond: ["$isCompleted", 1, 0] },
                },
                totalMy: {
                  $sum: { $cond: ["$isAssignedToMe", 1, 0] },
                },
              },
            },
          ],
          totalFiltered: [
            ...(matchStage ? [matchStage] : []),
            { $count: "count" },
          ],
          data: [
            ...(matchStage ? [matchStage] : []),
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
          ],
        },
      },
    ];

    const [result] = await orderCollection.aggregate(pipeline).toArray();

    const projects = result?.data || [];
    const totalProjects = result?.totalFiltered?.[0]?.count || 0;
    const countsData = result?.overallCounts?.[0] || {};
    const totalPages = Math.max(1, Math.ceil(totalProjects / limit));

    return res.status(200).json({
      success: true,
      projects,
      pagination: {
        currentPage: page,
        totalPages,
        totalProjects,
        limit,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        start: totalProjects === 0 ? 0 : skip + 1,
        end: Math.min(skip + limit, totalProjects),
      },
      counts: {
        all: countsData.totalAll || 0,
        active: countsData.totalActive || 0,
        completed: countsData.totalCompleted || 0,
        my: countsData.totalMy || 0,
      },
    });
  } catch (error) {
    console.error("Get all projects error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
