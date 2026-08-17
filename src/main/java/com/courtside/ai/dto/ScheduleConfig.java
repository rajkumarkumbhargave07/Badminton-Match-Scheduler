package com.courtside.ai.dto;

public record ScheduleConfig(
    Integer numPlayers,
    Integer durationValue,
    String durationUnit,
    Integer gamePoint,
    Integer matchCount
) {
}
