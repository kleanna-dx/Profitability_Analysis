package com.company.core.common.exception;

public class EntityNotFoundException extends RuntimeException {
    public EntityNotFoundException(String message) {
        super(message);
    }
    public EntityNotFoundException(String entityName, Object id) {
        super(entityName + " not found with id: " + id);
    }
}
