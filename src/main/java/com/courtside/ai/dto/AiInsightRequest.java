package com.courtside.ai.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record AiInsightRequest(
    @Size(max = 500) String question,
    @NotNull JsonNode schedulerState
) {
}
