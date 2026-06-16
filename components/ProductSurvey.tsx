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
        onSubmit({ userReportedDays: reportedDays, notes: notes || undefined });
        onClose();
    };

    const quickButtons = [
        { label: "3 days", value: 3 },
        { label: "1 week", value: 7 },
        { label: "2 weeks", value: 14 },
        { label: "1 month", value: 30 },
    ];

    return (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="pantry-card max-w-md w-full p-6 relative rise">
                <button onClick={onClose} className="absolute top-4 right-4 text-ink-faint hover:text-ink transition-colors">
                    <X className="w-6 h-6" />
                </button>

                <div className="mb-6">
                    <p className="kicker mb-1">Consumption survey</p>
                    <h2 className="font-display text-2xl font-semibold text-ink">How long did it last?</h2>
                    <p className="text-ink-soft mt-1">
                        Tell us about your <span className="font-semibold text-ink">{productName}</span>.
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                    {quickButtons.map((btn) => (
                        <button
                            key={btn.value}
                            onClick={() => setReportedDays(btn.value)}
                            className={`px-4 py-3 rounded-lg border-2 font-semibold transition-all ${reportedDays === btn.value
                                ? "border-terracotta bg-terracotta/10 text-terracotta"
                                : "border-line-strong hover:border-ink-faint text-ink-soft"
                                }`}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-semibold text-ink-soft mb-2">Or enter custom duration (days):</label>
                    <input
                        type="number"
                        min="1"
                        value={reportedDays}
                        onChange={(e) => setReportedDays(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full px-4 py-2 rounded-lg border border-line-strong bg-card text-ink focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta outline-none"
                    />
                </div>

                {isAnomaly && (
                    <div className="mb-4 p-4 bg-amber/10 border border-amber/30 rounded-lg">
                        <p className="text-sm font-semibold text-amber mb-1">
                            That seems {reportedDays < expectedDays ? "quite fast" : "longer than usual"}.
                        </p>
                        <p className="text-sm text-ink-soft mb-2">
                            A household of {familySize} usually takes around {expectedDays} days for this.
                        </p>
                        <button onClick={() => setShowAnomalyQuestions(!showAnomalyQuestions)} className="text-sm text-terracotta hover:text-terracotta-deep font-semibold">
                            {showAnomalyQuestions ? "Hide" : "Add"} a note
                        </button>
                    </div>
                )}

                {showAnomalyQuestions && (
                    <div className="mb-4">
                        <label className="block text-sm font-semibold text-ink-soft mb-2">Notes (optional):</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="E.g., had guests, used for multiple meals…"
                            className="w-full px-4 py-2 rounded-lg border border-line-strong bg-card text-ink focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta outline-none resize-none"
                            rows={3}
                        />
                    </div>
                )}

                <div className="flex gap-3">
                    <button onClick={onClose} className="btn-ghost flex-1 py-2.5">Cancel</button>
                    <button onClick={handleSubmit} className="btn-primary flex-1 py-2.5">Submit</button>
                </div>
            </div>
        </div>
    );
}
