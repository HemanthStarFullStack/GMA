"use client";

import { Package, Calendar, Trash2, CheckCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { formatStock } from "@/lib/formatStock";

interface ProductCardProps {
    item: any;
    onConsume: (id: string) => void;
    onDelete: (id: string) => void;
}

export default function ProductCard({ item, onConsume, onDelete }: ProductCardProps) {
    const { product, quantity, unit, purchaseDate, _id } = item;
    const [imgBroken, setImgBroken] = useState(false);

    return (
        <div className="pantry-card overflow-hidden group">
            <div className="flex p-4 gap-4">
                {/* Product image */}
                <div className="w-20 h-20 rounded-xl bg-paper-2 flex-shrink-0 overflow-hidden flex items-center justify-center border border-line">
                    {product.imageUrl && !imgBroken ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" onError={() => setImgBroken(true)} />
                    ) : (
                        <Package className="w-8 h-8 text-ink-faint" strokeWidth={1.6} />
                    )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    {product.brand && (
                        <p className="kicker mb-0.5 truncate">{product.brand}</p>
                    )}
                    <h3
                        className="font-display text-lg font-semibold text-ink leading-tight truncate"
                        title={product.name || "Unknown Product"}
                    >
                        {product.name || "Unknown Product"}
                    </h3>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <span className="pill bg-olive/10 text-olive">{formatStock(quantity, unit)}</span>
                        {product.flavor && <span className="pill bg-paper-2 text-ink-soft">{product.flavor}</span>}
                    </div>
                    <div className="mt-2 flex items-center text-xs text-ink-faint">
                        <Calendar className="w-3 h-3 mr-1" />
                        Added {formatDistanceToNow(new Date(purchaseDate))} ago
                    </div>
                </div>
            </div>

            <div className="border-t border-line flex divide-x divide-line">
                <button
                    onClick={() => onConsume(_id)}
                    data-tour="consume"
                    className="flex-1 py-3 text-sm font-semibold text-olive hover:bg-olive/5 transition-colors flex items-center justify-center gap-2"
                >
                    <CheckCircle className="w-4 h-4" />
                    Mark consumed
                </button>
                <button
                    onClick={() => onDelete(_id)}
                    className="flex-1 py-3 text-sm font-semibold text-berry hover:bg-berry/5 transition-colors flex items-center justify-center gap-2"
                >
                    <Trash2 className="w-4 h-4" />
                    Delete
                </button>
            </div>
        </div>
    );
}
