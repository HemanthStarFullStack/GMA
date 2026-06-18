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
    demoSeeded: boolean; // whether the one-time demo onboarding data has been created
    tourCompleted: boolean; // whether the new-user guided tour has run
    familySizeChangedAt?: Date; // when household size was last changed
    prevFamilySize?: number;    // household size before the last change
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
    familySizeChangedAt: { type: Date },
    prevFamilySize: { type: Number },
    createdAt: { type: Date, default: Date.now },
    demoSeeded: { type: Boolean, default: false },
    tourCompleted: { type: Boolean, default: false },
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

// Product Schema — a globally-shared catalogue keyed by barcode. Doubles as the
// self-learning cache: anything a user adds (via lookup or manually) is stored
// here so the next scan of the same barcode resolves instantly with no API call.
export interface IProduct extends Document {
    barcode: string;
    name: string;
    brand: string;
    flavor?: string;
    price?: string; // user-entered approx price (free-form, e.g. "₹199"); feeds prediction context
    category: string;
    imageUrl?: string | null;
    defaultUnit: string;
    averageDuration: number; // expected days a single unit lasts a household of 1
    aiPredicted: boolean; // true once Gemini has set averageDuration/category (vs heuristic fallback)
    addedBy: 'barcode' | 'manual' | 'demo';
    source?: 'upcitemdb' | 'openfoodfacts' | 'cache' | 'manual' | 'demo' | null;
    isDemo: boolean;
}

const ProductSchema = new Schema<IProduct>({
    barcode: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    brand: { type: String, default: '' },
    flavor: { type: String, default: '' },
    price: { type: String, default: '' },
    category: { type: String, default: 'Other' },
    imageUrl: { type: String, default: null },
    defaultUnit: { type: String, default: 'units' },
    averageDuration: { type: Number, default: 14 },
    aiPredicted: { type: Boolean, default: false },
    addedBy: { type: String, enum: ['barcode', 'manual', 'demo'], default: 'barcode' },
    source: { type: String, default: null },
    isDemo: { type: Boolean, default: false },
});

// Inventory Schema — productId stores the BARCODE (string), consistently joined
// against Product.barcode everywhere in the app.
export interface IInventory extends Document {
    userId: string;
    productId: string; // barcode
    quantity: number;
    unit: string;
    purchaseDate: Date;
    expiryDate?: Date;
    status: 'active' | 'consumed' | 'wasted' | 'expired';
    isDemo: boolean;
}

const InventorySchema = new Schema<IInventory>({
    userId: { type: String, required: true, index: true },
    productId: { type: String, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
    purchaseDate: { type: Date, default: Date.now },
    expiryDate: Date,
    status: { type: String, enum: ['active', 'consumed', 'wasted', 'expired'], default: 'active' },
    isDemo: { type: Boolean, default: false },
});

// Consumption Log Schema
export interface IConsumptionLog extends Document {
    userId: string;
    productId: string; // barcode
    inventoryId: string;
    consumedDate: Date;
    durationDays: number;
    surveyCompleted: boolean;
    isDemo: boolean;
    surveyData?: {
        userReportedDays: number;
        familySize: number;
        flagged: boolean;
        notes: string;
    };
}

const ConsumptionLogSchema = new Schema<IConsumptionLog>({
    userId: { type: String, required: true, index: true },
    productId: { type: String, required: true },
    inventoryId: { type: String, required: true },
    consumedDate: { type: Date, default: Date.now },
    durationDays: { type: Number, required: true },
    surveyCompleted: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
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
