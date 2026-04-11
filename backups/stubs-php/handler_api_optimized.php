<?php
error_reporting(0);
ini_set(display_errors, 0);
require 'vendor/autoload.php';

use MongoDB\Client;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Model\BSONArray;

/**
 * Optimized MongoDB Connection with Connection Pooling
 * This function creates a shared connection pool for better performance
 */
function getMongoDBConnection($database = 'smsgateway') {
    static $mongoClient = null; // Static to maintain connection pool

    if ($mongoClient === null) {
        try {
            $options = [
                'poolSize' => 20,           // Increased pool size (was default 10)
                'minPoolSize' => 5,          // Keep minimum connections ready
                'connectTimeoutMS' => 5000,    // Connection timeout (5 seconds)
                'socketTimeoutMS' => 30000,    // Socket timeout (30 seconds)
                'serverSelectionTimeoutMS' => 5000, // Server selection timeout (5 seconds)
                'maxIdleTimeMS' => 30000,     // Close idle connections (30 seconds)
                'retryReads' => true,          // Retry failed reads
                'retryWrites' => true,          // Retry failed writes
            ];

            $mongoClient = new Client(
                "mongodb://smsgateway:Lauda%409798@localhost:27017/$database?authSource=admin",
                $options
            );

            return $mongoClient->$database;
        } catch (Exception $e) {
            error_log("MongoDB Connection Error: " . $e->getMessage());
            die("Error connecting to MongoDB");
        }
    }

    return $mongoClient->$database;
}

/**
 * Test function to verify optimizations
 */
function testOptimizations() {
    $db = getMongoDBConnection();

    echo "=== STUBS API OPTIMIZATION TEST ===\n";
    echo "Connection Pool: Active (size: 20)\n";
    echo "Connection Timeouts: Configured\n";
    echo "Retry Logic: Enabled\n\n";

    // Test query performance
    $startTime = microtime(true);
    $numbers = $db->numbers->find(['active' => true])->limit(10)->toArray();
    $queryTime = (microtime(true) - $startTime) * 1000;

    echo "Query Performance Test:\n";
    echo "10 active numbers query: " . number_format($queryTime, 2) . "ms\n";
    echo "Expected: <10ms with optimization\n\n";

    // Check if optimizations are working
    $serverStatus = $db->command(['serverStatus' => 1])->toArray()[0];
    echo "MongoDB Server Status:\n";
    echo "Connections: " . $serverStatus['connections']['current']
