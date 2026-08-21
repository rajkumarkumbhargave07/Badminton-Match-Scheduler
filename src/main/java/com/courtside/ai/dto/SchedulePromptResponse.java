package com.courtside.ai.dto;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

public record SchedulePromptResponse(
    Integer numPlayers,
    Integer durationValue,
    String durationUnit,
    Integer gamePoint,
    Integer matchCount,
    Integer matchMinutes,
    List<String> playerNames,
    JsonNode matches,
    JsonNode balanceStats,
    String warning,
    String note
) {
}
