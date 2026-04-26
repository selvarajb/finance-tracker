const CONFIG = {
  // Spreadsheet ID here, left blank for user to fill
  SPREADSHEET_ID: "", 
  USERS_SHEET: "Users",
  CATEGORIES_SHEET: "Categories",
  TRANSACTIONS_SHEET: "Transactions",
  INVOICES_SHEET: "Invoices",
  ASSETS_SHEET: "Assets",
  BUDGET_SHEET: "Budget",
  VILLAS_SHEET: "Villas",
  FILES_SHEET: "Files"
};

/**
 * Serves the HTML UI
 */
function doGet(e) {
  // Use createTemplateFromFile to allow scriptlets to evaluate (e.g., pulling in css.html/js.html)
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
      .setTitle('Finance & Property Manager')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) // often needed if embedded
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Include separate HTML files (CSS, JS) into the main template
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Handles API Post calls, particularly login for now if we don't rely on google.script.run
 * Though google.script.run is usually preferred for App Script SPAs.
 * We will support doPost for any external triggers, and specific actions.
 */
function doPost(e) {
  const action = e.parameter.action;
  
  try {
    switch (action) {
      case "login":
        // implement plain POST login
        break;
      default:
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'Unknown Action'
        })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Example google.script.run function to verify login
 */
function verifyLogin(username, password) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); // Ensure deployed bound to a sheet or use openById
    const sheet = ss.getSheetByName(CONFIG.USERS_SHEET);
    if (!sheet) throw new Error("Users sheet not found");

    const data = sheet.getDataRange().getValues();
    // Start from row 1 (assuming row 0 is header: Username | Password | Role)
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] == username && data[i][1] == password) {
            return { success: true, role: data[i][2], username: username };
        }
    }
    return { success: false, message: "Invalid credentials" };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

/**
 * Utility to get generic sheet data
 */
function getSheetData(sheetName) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const result = [];
    
    for (let i = 1; i < data.length; i++) {
      let obj = {};
      for (let j = 0; j < headers.length; j++) {
        const key = String(headers[j]).trim();
        if (key) {
           let val = data[i][j];
           // CRITICAL FIX: google.script.run FAILS SILENTLY if returning Date objects from backend
           if (val && typeof val.getTime === 'function') {
               val = val.toISOString();
           }
           obj[key] = val;
        }
      }
      result.push(obj);
    }
    return result;
  } catch (err) {
    Logger.log(err);
    return [];
  }
}

/**
 * Appends a row to a given sheet
 * @param {string} sheetName 
 * @param {Object} rowData - map of header -> value
 */
function appendRow(sheetName, rowData) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error("Sheet not found: " + sheetName);
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = [];
    
    for (let i = 0; i < headers.length; i++) {
      const header = String(headers[i]).trim();
      const headerLower = header.toLowerCase().replace(/ /g, '');
      
      // Attempt fuzzy mapping
      let matchedVal = "";
      const rowKeys = Object.keys(rowData);
      for (let k = 0; k < rowKeys.length; k++) {
         if (rowKeys[k].toLowerCase().replace(/ /g, '') === headerLower) {
             matchedVal = rowData[rowKeys[k]];
             break;
         }
      }

      // Generate ID for the first column if it's named 'ID' and value is missing
      if (header.toUpperCase() === 'ID' && !matchedVal) {
        newRow.push(Utilities.getUuid());
      } else {
        newRow.push(matchedVal !== undefined ? matchedVal : "");
      }
    }
    sheet.appendRow(newRow);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

/**
 * Updates a row based on ID (assumes ID is first column)
 */
function updateRow(sheetName, idValue, updateData) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) throw new Error("Sheet not found: " + sheetName);
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == idValue) {
        const rowIndex = i + 1;
        for (let j = 0; j < headers.length; j++) {
          const header = String(headers[j]).trim();
          if (updateData[header] !== undefined) {
             sheet.getRange(rowIndex, j + 1).setValue(updateData[header]);
          }
        }
        return { success: true };
      }
    }
    return { success: false, message: "ID not found" };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

/**
 * Retrieves essential data for dashboard and app initialization
 */
function fetchInitialData() {
  try {
    return {
      success: true,
      data: {
        categories: getSheetData(CONFIG.CATEGORIES_SHEET),
        villas: getSheetData(CONFIG.VILLAS_SHEET),
        users: getSheetData(CONFIG.USERS_SHEET),
        transactions: getSheetData(CONFIG.TRANSACTIONS_SHEET),
        assets: getSheetData(CONFIG.ASSETS_SHEET),
        invoices: getSheetData(CONFIG.INVOICES_SHEET),
        budget: getSheetData(CONFIG.BUDGET_SHEET)
      }
    };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

/**
 * Handles adding a new transaction (Income or Expense)
 */
function addTransaction(txData) {
  try {
    // Generate an ID for the transaction
    const txId = Utilities.getUuid();
    txData['ID'] = txId;
    
    // Default Status logic for Workflow
    if (txData['Type'] === 'Expense') {
      txData['Status'] = 'Pending'; // Needs Approval by Admin
    } else {
      txData['Status'] = 'Approved';
    }

    const appendRes = appendRow(CONFIG.TRANSACTIONS_SHEET, txData);
    if (!appendRes.success) throw new Error(appendRes.message);

    // If ExpenseNature is Asset, auto-create asset
    if (txData['ExpenseNature'] === 'Asset') {
      const assetData = {
        'ID': Utilities.getUuid(),
        'Name': txData['Notes'] || 'New Asset',
        'Category': txData['CategoryID'],
        'Serial': txData['SerialNo'] || '',
        'PurchaseDate': txData['Date'],
        'Warranty': txData['Warranty'] || '',
        'Amount': txData['Amount'],
        'Bills': txData['AttachmentUrl'] || ''
      };
      appendRow(CONFIG.ASSETS_SHEET, assetData);
    }

    return { success: true, message: "Transaction added successfully", id: txId };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

/**
 * Update transaction status (Approval Workflow)
 */
function updateTransactionStatus(txId, status, approverName) {
  return updateRow(CONFIG.TRANSACTIONS_SHEET, txId, {
    'Status': status,
    'ApprovedBy': approverName
  });
}

/**
 * Creates an invoice
 */
function createInvoice(invoiceData) {
  try {
     const id = Utilities.getUuid();
     invoiceData['ID'] = id;
     invoiceData['Paid'] = 0;
     invoiceData['Status'] = 'Outstanding';
     
     const res = appendRow(CONFIG.INVOICES_SHEET, invoiceData);
     if (!res.success) throw new Error(res.message);
     return { success: true, message: "Invoice created." };
  } catch(err) {
     return { success: false, message: err.toString() };
  }
}

/**
 * Simple file upload logic (Google Drive)
 * Returns the URL of the created file
 */
function uploadFileToDrive(data, filename, type) {
  try {
     const folderIterator = DriveApp.getFoldersByName("FinanceTracker_Attachments");
     let folder;
     if (folderIterator.hasNext()) {
       folder = folderIterator.next();
     } else {
       folder = DriveApp.createFolder("FinanceTracker_Attachments");
     }
     
     const decoded = Utilities.base64Decode(data);
     const blob = Utilities.newBlob(decoded, type, filename);
     const file = folder.createFile(blob);
     return { success: true, url: file.getUrl() };
  } catch(err) {
     return { success: false, message: err.toString() };
  }
}

/**
 * Endpoint to add a generic record
 */
function addRecord(sheetName, data) {
    return appendRow(sheetName, data);
}
