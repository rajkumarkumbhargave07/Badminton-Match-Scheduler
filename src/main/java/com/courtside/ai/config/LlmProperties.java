package com.courtside.ai.config;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "llm")
public record LlmProperties(
    String baseUrl,
    String apiKey,
    String model,
    @Min(1) int timeoutSeconds
) {
}
