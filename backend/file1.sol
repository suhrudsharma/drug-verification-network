
contract PharmaChain {

    enum Status { 
        Manufactured, // 0: Created at factory
        InTransit,    // 1: With logistics/distributor
        AtRetailer,   // 2: At pharmacy/hospital
        Sold,         // 3: Sold to consumer (End of life)
        Recalled,     // 4: Flagged as dangerous (Zombie Check)
        Expired,      // 5: Past expiry date
        Verified      // 6: Parent-Child QR Link Verified (New State)
    }


    struct Medicine {
        string medicineId;          // e.g., "M-555" (QR on the Packet)
        string batchId;             // e.g., "B-101" (QR on the Big Box) - Parent ID
        string name;                // e.g., "Paracetamol 500mg"
        uint256 expectedWeight;     // Factory Weight in grams
        string manufacturerLoc;     // Origin GPS
        uint256 manufactureDate;    // Timestamp
        uint256 expiryDate;         // Timestamp
        
        // Dynamic Tracking Data
        address currentOwner;       // Wallet Address of current holder
        Status status;              // Current Status
        string lastLocation;        // Last known GPS
        uint256 lastUpdateTimestamp;// Time of last move
        
        bool exists;                // To check if medicine is real
    }

    mapping(string => Medicine) public medicines;

    mapping(string => uint256) public shelfLifePolicy;

    mapping(address => bool) public authorizedManufacturers;
    mapping(address => bool) public authorizedDistributors;

    address public admin;

    event MedicineCreated(string indexed medicineId, string indexed batchId, address indexed manufacturer);
    event MedicineMoved(string indexed medicineId, address indexed mover, string location, Status status);
    event MedicineRecalled(string indexed medicineId, string reason);
    event MedicineVerified(string indexed medicineId, bool isValid);
    event ShelfLifePolicyUpdated(string indexed medicineName, uint256 months);

    
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Access Denied: Admin only");
        _;
    }

    modifier onlyManufacturer() {
        require(authorizedManufacturers[msg.sender], "Access Denied: Not a Manufacturer");
        _;
    }

    constructor() {
        admin = msg.sender;
        authorizedManufacturers[msg.sender] = true; 
        authorizedDistributors[msg.sender] = true;
    }

    

    function authorizeUser(address _user, bool _isManufacturer) public onlyAdmin {
        if (_isManufacturer) {
            authorizedManufacturers[_user] = true;
        } else {
            authorizedDistributors[_user] = true;
        }
    }

    function recallMedicine(string memory _medicineId, string memory _reason) public onlyAdmin {
        require(medicines[_medicineId].exists, "Medicine does not exist");
        medicines[_medicineId].status = Status.Recalled;
        emit MedicineRecalled(_medicineId, _reason);
    }
    
    // Set policy: e.g., "Paracetamol" must be recalled if less than 3 months remain
    function setShelfLifePolicy(string memory _medicineName, uint256 _months) public onlyAdmin {
        shelfLifePolicy[_medicineName] = _months * 30 days; // Convert months to seconds
        emit ShelfLifePolicyUpdated(_medicineName, _months);
    }

    
    
    
    function checkExpiryAndRecall(string memory _medicineId) public {
        require(medicines[_medicineId].exists, "Medicine does not exist");
        Medicine storage m = medicines[_medicineId];
        
        
        uint256 thresholdSeconds = shelfLifePolicy[m.name];
        
       
        if (block.timestamp + thresholdSeconds >= m.expiryDate) {
            m.status = Status.Recalled;
            emit MedicineRecalled(_medicineId, "Recall: Approaching Expiry Date");
        }
    }

  
    function registerMedicine(
        string memory _medicineId, // The specific packet ID
        string memory _batchId,    // The parent box ID
        string memory _name,
        uint256 _weight,
        string memory _location,
        uint256 _expiryDate
    ) public onlyManufacturer {
        require(!medicines[_medicineId].exists, "Error: Medicine ID already exists");

        Medicine storage newMed = medicines[_medicineId];
        newMed.medicineId = _medicineId;
        newMed.batchId = _batchId;
        newMed.name = _name;
        newMed.expectedWeight = _weight;
        newMed.manufacturerLoc = _location;
        newMed.manufactureDate = block.timestamp;
        newMed.expiryDate = _expiryDate;
        newMed.currentOwner = msg.sender;
        newMed.status = Status.Manufactured;
        newMed.lastLocation = _location;
        newMed.lastUpdateTimestamp = block.timestamp;
        newMed.exists = true;

        emit MedicineCreated(_medicineId, _batchId, msg.sender);
    }

    
    function updateCheckpoint(
        string memory _medicineId,
        string memory _newLocation,
        Status _newStatus
    ) public {
        Medicine storage m = medicines[_medicineId];

       
        require(msg.sender == m.currentOwner || authorizedDistributors[msg.sender], "Ghost Detected");
        
        
        require(m.status != Status.Recalled, "Zombie Detected");
        require(m.status != Status.Sold, "Evil Twin Detected");

        
        m.status = _newStatus;
        m.lastLocation = _newLocation;
        m.lastUpdateTimestamp = block.timestamp;
        m.currentOwner = msg.sender;

        emit MedicineMoved(_medicineId, msg.sender, _newLocation, _newStatus);
    }

  
    
   
    function verifyBatchLink(string memory _medicineId, string memory _scannedBatchId) public {
        require(medicines[_medicineId].exists, "Medicine ID not found");
        
        Medicine storage m = medicines[_medicineId];

        
        if (keccak256(bytes(m.batchId)) == keccak256(bytes(_scannedBatchId))) {
            m.status = Status.Verified; // MARK AS VERIFIED
            emit MedicineVerified(_medicineId, true);
        } else {
            m.status = Status.Recalled; // FLAG AS SUSPICIOUS (Mismatch)
            emit MedicineVerified(_medicineId, false);
            emit MedicineRecalled(_medicineId, "Batch Link Mismatch: Potential Counterfeit");
        }
    }

    

    function getMedicineData(string memory _medicineId) public view returns (
        string memory batchId,
        string memory name,
        uint256 expectedWeight,
        string memory lastLocation,
        Status currentStatus,
        address owner,
        bool exists
    ) {
        Medicine memory m = medicines[_medicineId];
        return (
            m.batchId,
            m.name,
            m.expectedWeight,
            m.lastLocation,
            m.status,
            m.currentOwner,
            m.exists
        );
    }
}