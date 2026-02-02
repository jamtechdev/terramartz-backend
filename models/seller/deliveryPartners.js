import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const deliveryPartners = new mongoose.Schema({
  _id: {
    type: String,
    default: uuidv4,
  },
  name: {
    type: String,
    required: true,
  },
  seller: {
    type: String,
    ref: "User",
    required: true,
  },
});
export const DeliveryPartners = mongoose.model(
  "DeliveryPartners",
  deliveryPartners,
);
