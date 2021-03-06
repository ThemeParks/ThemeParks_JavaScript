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
* Enum class ReturnTimeState.
* @enum {}
* @readonly
*/
export default class ReturnTimeState {
    
        /**
         * value: "AVAILABLE"
         * @const
         */
        "AVAILABLE" = "AVAILABLE";

    
        /**
         * value: "TEMP_FULL"
         * @const
         */
        "TEMP_FULL" = "TEMP_FULL";

    
        /**
         * value: "FINISHED"
         * @const
         */
        "FINISHED" = "FINISHED";

    

    /**
    * Returns a <code>ReturnTimeState</code> enum value from a Javascript object name.
    * @param {Object} data The plain JavaScript object containing the name of the enum value.
    * @return {module:model/ReturnTimeState} The enum <code>ReturnTimeState</code> value.
    */
    static constructFromObject(object) {
        return object;
    }
}

