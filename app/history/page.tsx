"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, History as HistoryIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import UserMenu from "@/components/UserMenu";

export default function HistoryPage() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/history');
            const data = await res.json();
            if (data.success) {
                setLogs(data.data);
            }
        } catch (error) {
            console.error('Failed to fetch history:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-medium">Back</span>
                    </Link>
                    <h1 className="text-xl font-bold text-gray-900">Consumption History</h1>
                    <UserMenu />
                </div>
            </div>

            {/* Content */}
            <div className="container mx-auto px-4 py-6">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : logs.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <HistoryIcon className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No history yet</h3>
                        <p className="text-gray-500">Items you mark as consumed will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {logs.map((log: any) => (
                            <div key={log._id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="font-medium text-gray-900">Product {log.productId}</h3>
                                        <p className="text-sm text-gray-500">
                                            Consumed on {format(new Date(log.consumedDate), 'MMM d, yyyy')}
                                        </p>
                                    </div>
                                    <span className="text-sm font-medium text-gray-600">
                                        Lasted {log.durationDays} days
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
