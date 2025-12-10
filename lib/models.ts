import mongoose, { Schema, Document } from 'mongoose';

// User Schema (NextAuth Compatible)
export interface IUser extends Document {
    name?: string;
    email: string;
    image?: string;
    emailVerified?: Date;
    displayName: string;
    familySize: number;
    createdAt: Date;
    preferences: {
        surveyFrequency: 'always' | 'occasional';
    };
}

const UserSchema = new Schema<IUser>({
    name: { type: String },
    email: { type: String, required: true, unique: true },
    image: { type: String },
    emailVerified: { type: Date },
    displayName: { type: String, default: 'User' },
    familySize: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now },
    preferences: {
        surveyFrequency: { type: String, enum: ['always', 'occasional'], default: 'occasional' },
    },
});

// Auth Schemas for NextAuth Adapter
const AccountSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    type: String,
    provider: String,
    providerAccountId: String,
    refresh_token: String,
    access_token: String,
    expires_at: Number,
    token_type: String,
    scope: String,
    id_token: String,
    session_state: String,
});

const SessionSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    expires: Date,
    sessionToken: { type: String, unique: true },
});

const VerificationTokenSchema = new Schema({
    identifier: String,
    token: { type: String, unique: true },
    expires: Date,
});

export const Account = mongoose.models.Account || mongoose.model('Account', AccountSchema);
export const Session = mongoose.models.Session || mongoose.model('Session', SessionSchema);
export const VerificationToken = mongoose.models.VerificationToken || mongoose.model('VerificationToken', VerificationTokenSchema);

// Product Schema
export interface IProduct extends Document {
    barcode: string;
    name: string;
    brand: string;
    flavor?: string; // Added flavor field
    category: string;
    imageUrl?: string;
    defaultUnit: string;
    averageDuration: number; // days
    addedBy: 'barcode' | 'ai' | 'manual';
    confidence: number;
    imageVerified?: boolean; // NEW: If image was AI-verified
    imageConfidence?: number; // NEW: AI verification confidence score
    imageSource?: 'web' | 'ai' | 'manual' | null; // NEW: Where image came from
}

const ProductSchema = new Schema<IProduct>({
    barcode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    brand: { type: String, default: '' },
    flavor: { type: String, default: '' },
    category: { type: String, default: 'Other' },
    imageUrl: String,
    defaultUnit: { type: String, default: 'units' },
    averageDuration: { type: Number, default: 14 },
    addedBy: { type: String, enum: ['barcode', 'ai', 'manual'], required: true },
    confidence: { type: Number, default: 1.0 },
    imageVerified: { type: Boolean, default: false },
    imageConfidence: { type: Number, default: 0 },
    imageSource: { type: String, enum: ['web', 'ai', 'manual', null], default: null }
});

// Inventory Schema
export interface IInventory extends Document {
    userId: string;
    productId: string;
    quantity: number;
    unit: string;
    purchaseDate: Date;
    expiryDate?: Date;
    status: 'active' | 'consumed' | 'wasted' | 'expired';
}

const InventorySchema = new Schema<IInventory>({
    userId: { type: String, required: true },
    productId: { type: String, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
    purchaseDate: { type: Date, default: Date.now },
    expiryDate: Date,
    status: { type: String, enum: ['active', 'consumed', 'wasted', 'expired'], default: 'active' },
});

// Consumption Log Schema
export interface IConsumptionLog extends Document {
    userId: string;
    productId: string;
    inventoryId: string;
    consumedDate: Date;
    durationDays: number;
    surveyCompleted: boolean;
    surveyData?: {
        userReportedDays: number;
        familySize: number;
        flagged: boolean;
        notes: string;
    };
}

const ConsumptionLogSchema = new Schema<IConsumptionLog>({
    userId: { type: String, required: true },
    productId: { type: String, required: true },
    inventoryId: { type: String, required: true },
    consumedDate: { type: Date, default: Date.now },
    durationDays: { type: Number, required: true },
    surveyCompleted: { type: Boolean, default: false },
    surveyData: {
        userReportedDays: Number,
        familySize: Number,
        flagged: Boolean,
        notes: String,
    },
});

// Export models
export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);
export const Inventory = mongoose.models.Inventory || mongoose.model<IInventory>('Inventory', InventorySchema);
export const ConsumptionLog = mongoose.models.ConsumptionLog || mongoose.model<IConsumptionLog>('ConsumptionLog', ConsumptionLogSchema);
