<?php
//error_reporting(E_ALL);
//ini_set('display_errors', 1);
// error_reporting(0);
// ini_set('display_errors', 0);
require 'vendor/autoload.php';
use MongoDB\Client;
use MongoDB\BSON\ObjectId;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Model\BSONArray;

function getMongoDBConnection($database = 'smsgateway') {
    try {
        $mongoClient = new Client("mongodb://smsgateway:Trainman%40843411@localhost:27017/$database?authSource=smsgateway");
        return $mongoClient->$database;
    } catch (Exception $e) {
        die("Error connecting to MongoDB: " . $e->getMessage());
    }
}


// =========================
// Regex Builder
// =========================
function escapeRegex($str) {
    return preg_replace('/([-\/\\\\^$*+?.()|[\]{}])/', '\\\\$1', $str);
}

function buildSmartOtpRegexList($service) {
    if (empty($service['formate'])) return [];

    // Convert BSON to PHP array/string
    $formate = $service['formate'];
    if ($formate instanceof \MongoDB\Model\BSONArray) {
        $formats = $formate->getArrayCopy();
    } elseif (is_string($formate)) {
        $formats = [$formate];
    } else {
        $formats = (array) $formate; // fallback
    }

    $patterns = [];

    foreach ($formats as $format) {
        if (!is_string($format)) continue; // skip invalid entries
        if (strpos($format, '{otp}') === false) continue;

        $pattern = escapeRegex($format);

        // Handle {otp} (allow 3–8 digits OR 3-3 digits like 597-478)
        $otpCount = 0;
        $pattern = preg_replace_callback('/\\\\\{otp\\\\\}/i', function() use (&$otpCount) {
            $otpCount++;
            return $otpCount === 1 
                ? '(?P<otp>\d{3,8}|\d{3}-\d{3})' 
                : '(\d{3,8}|\d{3}-\d{3})';
        }, $pattern);

        // Replace placeholders
        $pattern = preg_replace('/\\\\\{date\\\\\}/i', '.*', $pattern);
        $pattern = preg_replace('/\\\\\{datetime\\\\\}/i', '.*', $pattern);
        $pattern = preg_replace('/\\\\\{.*?\\\\\}/i', '.*', $pattern);

        // Make spaces/punctuation flexible
        $pattern = preg_replace('/\\\\s+/', '\s*', $pattern);
        $pattern = preg_replace('/\\\\:/', '[:：]?', $pattern);
        $pattern = preg_replace('/\\\\\./', '.*', $pattern);

        $patterns[] = [
            'regex' => '/' . $pattern . '/i',
            'service' => $service['name'] ?? '',
            'code' => $service['code'] ?? '',
        ];
    }

    return $patterns;
}



// =========================
// OTP & Service Detector
// =========================
function detectOtpFromMessage($message) {
    $db = getMongoDBConnection();
    $services = $db->services->find(['active' => true])->toArray();

    $patterns = [];
    foreach ($services as $service) {
        $patterns = array_merge($patterns, buildSmartOtpRegexList($service));
    }

    foreach ($patterns as $p) {
        if (preg_match($p['regex'], $message, $matches)) {
            return [
                'service' => $p['service'],
                'code' => $p['code'],
                'otp' => $matches['otp'] ?? null,
            ];
        }
    }

    return null;
}


function buynumber($request) {
    try {
        $db = getMongoDBConnection();
        
        $params = $_GET;
        if (!isset($params['api_key']) || !$params['api_key']) {
            return "BAD_KEY";
        }
        if (!isset($params['service']) || !$params['service']) {
            return "BAD_SERVICE";
        }
        if (!isset($params['country']) || $params['country'] === '') {
            return "BAD_COUNTRY";
        }

        $service = $params['service'];
       $country = (string) $params['country'];
        $api_key = $params['api_key'];

        $userdata = $db->users->findOne(['apikey' => $api_key]);
        if (!$userdata) return "BAD_KEY";
        if (isset($userdata['ban']) && $userdata['ban'] === true) {
            return "ACCOUNT_BAN";
        }

        $servicesdata = $db->services->findOne(['code' => $service, 'active' => true]);
        if (!$servicesdata) return "BAD_SERVICE";

        $countrydata = $db->countires->findOne(['code' => $country, 'active' => true]);
        if (!$countrydata) return "BAD_COUNTRY";

        $maxTries = 6;
        $validNumber = null;

        for ($i = 0; $i < $maxTries; $i++) {
            $availableNumbers = $db->numbers->aggregate([
                ['$match' => ['active' => true, 'countryid' => $countrydata->_id]],
                ['$sample' => ['size' => 1]]
            ])->toArray();

            if (empty($availableNumbers)) {
                return "NO_NUMBER"; 
            }

            $numberDoc = $availableNumbers[0];
 $islocked = $db->locks->findOne([
    'number' => $numberDoc['number'],
    'countryid' => $countrydata->_id,
    'serviceid' => $servicesdata->_id,
    'locked' => true,
]);
if ($islocked) {
    continue;
}
 $isUsedInOrders = $db->orders->findOne([
    'number' => $numberDoc['number'],
    'countryid' => $countrydata->_id,
    'serviceid' => $servicesdata->_id,
    'active' => true,
    'isused' => false
]);


if ($isUsedInOrders) {
    continue;
}


$fourHoursAgo = new MongoDB\BSON\UTCDateTime((time() - 4 * 3600) * 1000);

$recentOrder = $db->orders->findOne([
    'number' => $numberDoc['number'],
    'countryid' => $countrydata->_id,
    'serviceid' => $servicesdata->_id,
    'isused' => true,
    'createdAt' => ['$gte' => $fourHoursAgo]
]);

if ($recentOrder) {
    continue; 
}


           
            $validNumber = $numberDoc;
            break;
        }

        if (!$validNumber) {
            return "NO_NUMBER";
        }
$collection = $db->orders;


$result = $collection->insertOne([
    "number" => $validNumber['number'],
    "countryid" => $countrydata->_id,
    "serviceid" => $servicesdata->_id,
    "dialcode" => $countrydata->dial,
    "isused" => false,
    "ismultiuse" => true,
    "nextsms" => false,
    "message" => [],
    "keywords" => $servicesdata->keywords,
    "formate" => $servicesdata->formate,
    "maxmessage" => $servicesdata->maxmessage,
    "active" => true,
    'createdAt' => new MongoDB\BSON\UTCDateTime(time() * 1000),
    "updatedAt" => new MongoDB\BSON\UTCDateTime(time() * 1000),
    "__v" => 0
]);
if($result){
       return "ACCESS_NUMBER:" . $result->getInsertedId() . ":91".$validNumber['number']."";
}else{
return "NO_NUMBER";
}
    } catch (Exception $error) {
        return $error;
    }
}



function getsms($request){
    try{
        $db = getMongoDBConnection();
        
        $params = $_GET;
        if (!isset($params['api_key']) || !$params['api_key']) {
            return "BAD_KEY";
        }
        if (!isset($params['id']) || !$params['id']) {
            return "NO_ACTIVATION";
        }
        $id = $params['id'];
        $api_key = $params['api_key'];
        $userdata = $db->users->findOne(['apikey' => $api_key]);
        if (!$userdata) {
            return "BAD_KEY";
        }
        $userid = $userdata["_id"];
        $id = new ObjectId($id);
        $order = $db->orders->findOne([
            "_id" => $id,
            "active" => true
        ]);
        if($order){
            $givenTime = $order["createdAt"];

            if ($givenTime instanceof UTCDateTime) {
                $givenTime = $givenTime->toDateTime();
            } else {
                $givenTime = new DateTime($givenTime);
            }
            
            $currentTime = new DateTime();
            $diffInSeconds = $currentTime->getTimestamp() - $givenTime->getTimestamp();
            $twentyMinutesInSeconds = 20 * 60; 
            
            if ($diffInSeconds < $twentyMinutesInSeconds) {
                $secondsLeft = $twentyMinutesInSeconds - $diffInSeconds;
                $bsonArray = new BSONArray($order['message']);
            
                $array = iterator_to_array($bsonArray);
                $slice = array_slice($array, -1, 1, true);
                $otp = end($slice);
                $otp = str_replace(":", "", $otp);
                if($otp == ""){
                    return "STATUS_WAIT_CODE";
                }else{
                return "STATUS_OK:$otp";
                }
            } else {
                return "STATUS_CANCEL";
            }
        }else{
         return "NO_ACTIVATION";
        }
    } catch (Exception $error){
        return "NO_ACTIVATION";
    }
}


function setcancel($request){
    try{
        $db = getMongoDBConnection();
        
        $params = $_GET;
        if (!isset($params['api_key']) || !$params['api_key']) {
            return "BAD_KEY";
        }
        if (!isset($params['id']) || !$params['id']) {
            return "NO_ACTIVATION";
        }
        if (!isset($params['status']) || !$params['status']) {
            return "BAD_STATUS";
        }
        if($params['status'] == 8){
        $id = $params['id'];
        $api_key = $params['api_key'];
        $userdata = $db->users->findOne(['apikey' => $api_key]);
        if (!$userdata) {
            return "BAD_KEY";
        }
        $id = new ObjectId($id);
        $order = $db->orders->findOne([
            "_id" => $id,
            "active" => true
        ]);
        if($order){
            if (!$order['isused']) {
    // Check if createdAt < 2 minutes ago
                    $givenTime = $order["createdAt"];
                    $now = new \MongoDB\BSON\UTCDateTime();
                    $diffMs = $now->toDateTime()->getTimestamp() - $givenTime->toDateTime()->getTimestamp();

                    if ($diffMs < 120) { 
                        return "EARLY_CANCEL_DENIED"; // Less than 2 minutes
                    }
            $updatedOrder = $db->orders->findOneAndUpdate(
                ['_id' => $order['_id'], 'active' => true, 'isused' => false],
                ['$set' => ['active' => false]],
                ['new' => true]
            );
            return "ACCESS_CANCEL";
        }else{
            $msg = $db->orders->findOneAndUpdate(
                ['_id' => $order['_id'], 'active' => true],
                ['$set' => ['active' => false, 'isused' => true]],
                ['new' => true]
            );
            return "ACCESS_ACTIVATION";
        } 
        }else{
         return "NO_ACTIVATION";
        }
    }elseif($params['status'] == 3){
        $id = $params['id'];
        $api_key = $params['api_key'];
        $userdata = $db->users->findOne(['apikey' => $api_key]);
        if (!$userdata) {
            return "BAD_KEY";
        }
          $id = new ObjectId($id);
        $order = $db->orders->findOne([
            "_id" => $id,
            "active" => true
        ]);
        if($order){
            if($order['isused']){
$msg = $db->orders->findOneAndUpdate(
    ['_id' => $order['_id']],
    [
        '$set' => [
            'nextsms'   => true,
            'updatedAt' => new \MongoDB\BSON\UTCDateTime()
        ]
    ],
    ['returnDocument' => \MongoDB\Operation\FindOneAndUpdate::RETURN_DOCUMENT_AFTER]
);

            return "ACCESS_RETRY_GET";
        }else{
        return "ACCESS_READY";
        }
        }else{
         return "NO_ACTIVATION";
        }
    }else{
        return "BAD_STATUS"; 
    }
    } catch (Exception $error){
        return "ERROR_DATABASE";
    } 
}


function checksms($request){
    try{
        $db = getMongoDBConnection();
        
        $params = $_GET;
        if (!isset($params['api_key']) || !$params['api_key']) {
            return "BAD_KEY";
        }
        if (!isset($params['text']) || !$params['text']) {
            return "NO_TEXT";
        }
        $text = $params['text'];
        $api_key = $params['api_key'];
        $userdata = $db->users->findOne(['apikey' => $api_key]);
        if (!$userdata) {
            return "BAD_KEY";
        }
       $smsText = $argv[1] ?? $text;
$result = detectOtpFromMessage($smsText);

if ($result) {
    return $result['otp'].":".$result['service'];

} else {
    return "NOT_AVAILABLE";
}
    } catch (Exception $error){
        return "ERROR_DATABASE";
    } 
}
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['action'])) {
        $action = $_GET['action'];
        
        if ($action == "getNumber") {
            echo buynumber($_GET);
        } elseif ($action == "getStatus") {
            echo getsms($_GET);
        } elseif ($action == "setStatus") {
            echo setcancel($_GET);

        } elseif ($action == "CheckSMS") {
            echo checksms($_GET);
        }else{
        echo "WRONG_ACTION";
        }
    } else {
        echo "NO_ACTION";
    }
}

?>
