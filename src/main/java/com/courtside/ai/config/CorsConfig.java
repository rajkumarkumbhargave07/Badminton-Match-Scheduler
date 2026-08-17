package com.courtside.ai.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

  private final AppCorsProperties properties;

  public CorsConfig(AppCorsProperties properties) {
    this.properties = properties;
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/api/**")
        .allowedOrigins(properties.allowedOrigins().toArray(String[]::new))
        .allowedMethods("GET", "POST", "OPTIONS")
        .allowedHeaders("Content-Type", "Authorization")
        .maxAge(3600);
  }
}
