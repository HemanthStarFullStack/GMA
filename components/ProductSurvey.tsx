"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface ProductSurveyProps {
    isOpen: boolean;
    onClose: () => void;
    productName: string;
    expectedDays: number;
    familySize?: number;
    onSubmit: (data: { userReportedDays: number; notes?: string }) => void;
}

export default function ProductSurvey({
    isOpen,
    onClose,
    productName,
    expectedDays,
    familySize = 1,
    onSubmit,
}: ProductSurveyProps) {
    const [reportedDays, setReportedDays] = useState<number>(expectedDays);
    const [notes, setNotes] = useState("");
    const [showAnomalyQuestions, setShowAnomalyQuestions] = useState(false);

    if (!isOpen) return null;

    const isAnomaly = Math.abs(reportedDays - expectedDays) > expectedDays * 0.3;

    const handleSubmit = () => {
        onSubmit({
            userReportedDays: reportedDays,
            notes: notes || undefined,
        });
        onClose();
    };

    const quickButtons = [
        { label: "3 days", value: 3 },
        { label: "1 week", value: 7 },
        { label: "2 weeks", value: 14 },
        { label: "1 month", value: 30 },
    ];

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X className="w-6 h-6" />
                </button>

                {/* Header */}
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        How Long Did It Last?
                    </h2>
                    <p className="text-gray-600">
                        Tell us about your <span className="font-semibold">{productName}</span> consumption
                    </p>
                </div>

                {/* Quick Buttons */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    {quickButtons.map((btn) => (
                        <button
                            key={btn.value}
                            onClick={() => setReportedDays(btn.value)}
                            className={`px-4 py-3 rounded-lg border-2 font-medium transition-all ${reportedDays === btn.value
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-gray-200 hover:border-gray-300 text-gray-700"
                                }`}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>

                {/* Custom Input */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Or enter custom duration (days):
                    </label>
                    <input
                        type="number"
                        min="1"
                        value={reportedDays}
                        onChange={(e) => setReportedDays(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                {/* Anomaly Detection */}
                {isAnomaly && (
                    <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-sm font-medium text-yellow-800 mb-2">
                            ⚠️ That seems {reportedDays < expectedDays ? "quite fast" : "longer than usual"}!
                        </p>
                        <p className="text-sm text-yellow-700 mb-3">
                            Most families of {familySize} take around {expectedDays} days for this product.
                        </p>
                        <button
                            onClick={() => setShowAnomalyQuestions(!showAnomalyQuestions)}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                        >
                            {showAnomalyQuestions ? "Hide" : "Add"} additional details
                        </button>
                    </div>
                )}

                {/* Anomaly Questions */}
                {showAnomalyQuestions && (
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Additional notes (optional):
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="E.g., Had guests, used for multiple meals, product was smaller than usual..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                            rows={3}
                        />
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl"
                    >
                        Submit
                    </button>
                </div>
            </div>
        </div>
    );
}
