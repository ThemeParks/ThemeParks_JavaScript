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
 * The EntityDataLocation model module.
 * @module model/EntityDataLocation
 * @version 6.0.1
 */
class EntityDataLocation {
    /**
     * Constructs a new <code>EntityDataLocation</code>.
     * @alias module:model/EntityDataLocation
     */
    constructor() { 
        
        EntityDataLocation.initialize(this);
    }

    /**
     * Initializes the fields of this object.
     * This method is used by the constructors of any subclasses, in order to implement multiple inheritance (mix-ins).
     * Only for internal use.
     */
    static initialize(obj) { 
    }

    /**
     * Constructs a <code>EntityDataLocation</code> from a plain JavaScript object, optionally creating a new instance.
     * Copies all relevant properties from <code>data</code> to <code>obj</code> if supplied or a new instance if not.
     * @param {Object} data The plain JavaScript object bearing properties of interest.
     * @param {module:model/EntityDataLocation} obj Optional instance to populate.
     * @return {module:model/EntityDataLocation} The populated <code>EntityDataLocation</code> instance.
     */
    static constructFromObject(data, obj) {
        if (data) {
            obj = obj || new EntityDataLocation();

            if (data.hasOwnProperty('latitude')) {
                obj['latitude'] = ApiClient.convertToType(data['latitude'], 'Number');
            }
            if (data.hasOwnProperty('longitude')) {
                obj['longitude'] = ApiClient.convertToType(data['longitude'], 'Number');
            }
        }
        return obj;
    }


}

/**
 * @member {Number} latitude
 */
EntityDataLocation.prototype['latitude'] = undefined;

/**
 * @member {Number} longitude
 */
EntityDataLocation.prototype['longitude'] = undefined;






export default EntityDataLocation;

