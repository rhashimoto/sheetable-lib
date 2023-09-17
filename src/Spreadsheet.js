// Set up lookup to convert between A1 spreadsheet cell notation
// and row/column index. Most spreadsheets don't have 18,278 columns
// so configure the mappings in batches.
/** @type {string[]} */ const mapIndexToAlpha = [];
/** @type {Map<string, number>} */ const mapAlphaToIndex = new Map();

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHA1_COUNT = 26;
const ALPHA2_COUNT = ALPHA1_COUNT + 26 * 26;
const ALPHA3_COUNT = ALPHA2_COUNT + 26 * 26 * 26;

/**
 * @typedef Address
 * @property {number} columnIndex
 * @property {number} rowIndex
 * @property {number} [columnCount]
 * @property {number} [rowCount]
 */

export class Spreadsheet {
  properties = {};
  /** @type {Sheet[]} */ sheets = [];

  /**
   * @param {*} [title] 
   * @returns {Sheet}
   */
  addSheet(title) {
    const sheet = new Sheet();
    if (title) {
      sheet.properties.title = title;
    }
    this.sheets.push(sheet);
    return sheet;
  }
}

export class Sheet {
  properties = {};

  /**
   * Specialization of setGridData() for setting values.
   * @param {string|Address} range 
   * @param {string|number|boolean|((columnIndex: number, rowIndex: number) => string|number|boolean)} values 
   */
  setGridValues(range, values) {
    const f = typeof values === 'function' ? values : () => values;

    this.setGridData(range, (columnIndex, rowIndex) => {
      let userEnteredValue;
      const value = f(columnIndex, rowIndex);
      switch (typeof value) {
        case 'string':
          if (value.startsWith('=')) {
            userEnteredValue = { formulaValue: value };
          } else {
            userEnteredValue = { stringValue: value };
          }
          break;
        case 'number':
          userEnteredValue = { numberValue: value };
          break;
        case 'boolean':
          userEnteredValue = { boolValue: value };
          break;
        default:
          break;
      }
      return userEnteredValue ? { userEnteredValue } : {};
    });
  }

  /**
   * @param {string|Address} range 
   * @param {(columnIndex: number, rowIndex: number) => object} f 
   */
  setGridData(range, f) {
    if (typeof range === 'string') {
      range = Sheet.fromA1(range);
    } else {
      validateAddress(range);
    }

    range = Object.assign({
      columnCount: 1,
      rowCount: 1
    }, range);

    const gridData = {
      startRow: range.rowIndex,
      startColumn: range.columnIndex,
      rowData: [],
    };
    for (let i = 0; i < range.rowCount; i++) {
      const rowData = {
        values: [],
      };
      for (let j = 0; j < range.columnCount; j++) {
        const cellData = f(j + range.columnIndex, i + range.rowIndex);
        rowData.values.push(cellData);
      }
      gridData.rowData.push(rowData.values.length ? rowData : {});
    }

    this.data = this.data ?? [];
    this.data.push(gridData);

    // Update grid size.
    if (!this.properties.gridProperties) {
      this.properties.gridProperties = {
        rowCount: 0,
        columnCount: 0
      };
    }

    const gp = this.properties.gridProperties;
    gp.rowCount = Math.max(gp.rowCount, range.rowIndex + range.rowCount);
    gp.columnCount = Math.max(gp.columnCount, range.columnIndex + range.columnCount);
  }

  /**
   * @param {string|Address} address 
   * @returns 
   */
  getGridCell(address) {
    if (typeof address === 'string') {
      address = Sheet.fromA1(address);
    } else {
      validateAddress(address);
    }

    if (!(address.rowIndex < this.properties.gridProperties?.rowCount) ||
        !(address.columnIndex < this.properties.gridProperties?.columnCount)) {
      return null;
    }
    
    for (const gridData of this.data?.toReversed() ?? []) {
      if (address.columnIndex < gridData.startColumn) continue;
      if (address.rowIndex < gridData.startRow) continue;
      if (address.rowIndex >= gridData.startRow + gridData.rowData.length) continue;

      const rowData = gridData.rowData[address.rowIndex - gridData.startRow];
      if (address.columnIndex < gridData.startColumn + rowData.values.length) {
        return rowData.values[address.columnIndex - gridData.startColumn];
      }
    }
    return {};
  }

  /**
   * @param {Address} address
   * @returns {string}
   */
  static toA1(address) {
    validateAddress(address);
    const { columnIndex, rowIndex, columnCount, rowCount } = address;

    // Ensure that the mappings are prepared.
    const maxColumnIndex = columnIndex + (columnCount ?? 0);
    if (maxColumnIndex > ALPHA1_COUNT) {
      alpha2();
      if (maxColumnIndex > ALPHA2_COUNT) {
        alpha3();
      }
    }

    const alphaX = mapIndexToAlpha[columnIndex];
    const numberX = rowIndex + 1;
    if (!rowCount) {
      return `${alphaX}${numberX}`;
    }

    const alphaY = mapIndexToAlpha[columnIndex + columnCount - 1];
    const numberY = rowIndex + rowCount; // 1-based so no need to subtract 1.
    return `${alphaX}${numberX}:${alphaY}${numberY}`;
  }

  /**
   * @param {string} address 
   * @returns {Address}
   */
  static fromA1 = (function() {
    const re = /^([A-Za-z]{1,3})([1-9]\d*)(?::([A-Za-z]{1,3})([1-9]\d*))?$/;
    return function(address) {
      const m = address.match(re);
      if (!m) throw new Error(`Invalid A1 address: ${address}`);

      // let [, alphaX, numberX, alphaY, numberY] = m;
      let alphaX = m[1];
      let numberX = parseInt(m[2], 10);
      let alphaY = m[3];
      let numberY = m[4] && parseInt(m[4], 10);
      if (alphaY) {
        // Order coordinates low to high.
        if (alphaY.lengh < alphaX.length ||
            (alphaY.length === alphaX.length && alphaY < alphaX)) {
          ([alphaX, alphaY] = [alphaY, alphaX]);
        }
        if (numberY < numberX) {
          ([numberX, numberY] = [numberY, numberX]);
        }
      }

      // Ensure that the mappings are prepared.
      switch ((alphaY ?? alphaX).length) {
        case 2: alpha2(); break;
        case 3: alpha3(); break;
      }

      const columnIndex = mapAlphaToIndex.get(alphaX);
      const rowIndex = numberX - 1;
      const result = { rowIndex, columnIndex };

      if (alphaY) {
        // Counts are inclusive.
        result.columnCount = mapAlphaToIndex.get(alphaY) - columnIndex + 1;
        result.rowCount = numberY - rowIndex;
      }
      return result;
    };
  })();


}

// Add A to Z.
function alpha1() {
  for (let i = 0; i < ALPHABET.length; i++) {
    const index = mapIndexToAlpha.length;
    const alpha = ALPHABET[i];
    mapIndexToAlpha.push(alpha);
    mapAlphaToIndex.set(alpha, index);
  }
}
alpha1();

// Extend mapping to ZZ.
function alpha2() {
  if (mapIndexToAlpha.length >= ALPHA2_COUNT) return;

  for (let i = 0; i < ALPHABET.length; i++) {
    const a0 = ALPHABET[i];
    for (let j = 0; j < ALPHABET.length; j++) {
      const index = mapIndexToAlpha.length;
      const alpha = a0 + ALPHABET[j];
      mapIndexToAlpha.push(alpha);
      mapAlphaToIndex.set(alpha, index);
    }
  }
}

// Extend mapping to ZZZ.
function alpha3() {
  if (mapIndexToAlpha.length >= ALPHA3_COUNT) return;

  alpha2();
  for (let i = 0; i < ALPHABET.length; i++) {
    const a0 = ALPHABET[i];
    for (let j = 0; j < ALPHABET.length; j++) {
      const a1 = a0 + ALPHABET[j];
      for (let k = 0; k < ALPHABET.length; k++) {
        const index = mapIndexToAlpha.length;
        const alpha = a1 + ALPHABET[k];
        mapIndexToAlpha.push(alpha);
        mapAlphaToIndex.set(alpha, index);
      }
    }
  }
}

function validateAddress(address) {
  const { rowIndex, columnIndex, rowCount, columnCount } = address;

  const isRowIndexValid = isNNI(rowIndex);
  const isColumnIndexValid = isNNI(columnIndex);
  const hasRowCount = rowCount !== undefined;
  const hasColumnCount = columnCount !== undefined;
  const isRowCountValid = !hasRowCount || isNNI(rowCount);
  const isColumnCountValid = !hasColumnCount || isNNI(columnCount);
  if (!isRowIndexValid || !isColumnIndexValid ||
      !isRowCountValid || !isColumnCountValid ||
      hasRowCount !== hasColumnCount) {
    throw new Error(`Invalid address: ${JSON.stringify(address)}`);
  }
}

// Test for non-negative integer.
function isNNI(value) {
  return value === (value | 0) && value >= 0;
}