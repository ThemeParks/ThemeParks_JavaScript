/**
 * Theme Parks Wiki V1 API
 * api.themeparks.wiki
 *
 * The version of the OpenAPI document: 1.0.0-alpha
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 *
 */

import ApiClient from '../ApiClient';

/**
 * The PriceData model module.
 * @module model/PriceData
 * @version 6.0.1
 */
class PriceData {
    /**
     * Constructs a new <code>PriceData</code>.
     * @alias module:model/PriceData
     */
    constructor() { 
        
        PriceData.initialize(this);
    }

    /**
     * Initializes the fields of this object.
     * This method is used by the constructors of any subclasses, in order to implement multiple inheritance (mix-ins).
     * Only for internal use.
     */
    static initialize(obj) { 
    }

    /**
     * Constructs a <code>PriceData</code> from a plain JavaScript object, optionally creating a new instance.
     * Copies all relevant properties from <code>data</code> to <code>obj</code> if supplied or a new instance if not.
     * @param {Object} data The plain JavaScript object bearing properties of interest.
     * @param {module:model/PriceData} obj Optional instance to populate.
     * @return {module:model/PriceData} The populated <code>PriceData</code> instance.
     */
    static constructFromObject(data, obj) {
        if (data) {
            obj = obj || new PriceData();

            if (data.hasOwnProperty('amount')) {
                obj['amount'] = ApiClient.convertToType(data['amount'], 'Number');
            }
            if (data.hasOwnProperty('currency')) {
                obj['currency'] = ApiClient.convertToType(data['currency'], 'String');
            }
        }
        return obj;
    }


}

/**
 * @member {Number} amount
 */
PriceData.prototype['amount'] = undefined;

/**
 * @member {String} currency
 */
PriceData.prototype['currency'] = undefined;






export default PriceData;

