"use client";

import { Package, Calendar, Trash2, CheckCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ProductCardProps {
    item: any;
    onConsume: (id: string) => void;
    onDelete: (id: string) => void;
}

export default function ProductCard({ item, onConsume, onDelete }: ProductCardProps) {
    const { product, quantity, unit, purchaseDate, _id } = item;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
            <div className="flex p-4 gap-4">
                {/* Product Image */}
                <div className="w-20 h-20 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden flex items-center justify-center">
                    {product.imageUrl ? (
                        <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <Package className="w-8 h-8 text-gray-400" />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    {/* Brand Name (Top) */}
                    <p className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-0.5">
                        {product.brand || 'Unknown Brand'}
                    </p>

                    {/* Flavor / Product Name (Middle) */}
                    <h3 className="font-medium text-gray-900 leading-tight mb-1 line-clamp-2">
                        {product.flavor || product.name || 'Unknown Product'}
                    </h3>

                    {/* Quantity (Bottom) */}
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                            {quantity} {unit}
                        </span>
                    </div>

                    <div className="mt-2 flex items-center text-xs text-gray-500">
                        <Calendar className="w-3 h-3 mr-1" />
                        Added {formatDistanceToNow(new Date(purchaseDate))} ago
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="border-t border-gray-50 flex divide-x divide-gray-50">
                <button
                    onClick={() => onConsume(_id)}
                    className="flex-1 py-3 text-sm font-medium text-green-600 hover:bg-green-50 transition-colors flex items-center justify-center gap-2"
                >
                    <CheckCircle className="w-4 h-4" />
                    Mark Consumed
                </button>
                <button
                    onClick={() => onDelete(_id)}
                    className="flex-1 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                >
                    <Trash2 className="w-4 h-4" />
                    Delete
                </button>
            </div>
        </div>
    );
}
